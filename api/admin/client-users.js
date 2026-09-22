const { checkAdminSecret } = require('../../lib/adminAuth');
const { hashPassword } = require('../../lib/clientAuth');
const {
  listClientUsers, listAllClientUsers, createClientUser, updateClientUser, deleteClientUser, countOwners
} = require('../../lib/clientUsers');

// GET/POST/PATCH/DELETE /api/admin/client-users[?slug=acme] — обзор и
// управление пользователями клиентов ИЗ АДМИНКИ (Ethan, 21 сен 2026: "видеть
// всех пользователей и их пароли" — сами пароли необратимо хешированы,
// см. lib/clientAuth.js, поэтому вместо просмотра — список логинов/ролей
// всех клиентов сразу плюс возможность создать пользователя или сбросить
// ему пароль на новый). В отличие от api/client-users.js (тот требует роль
// owner именно этого клиента), здесь единственный гейт — x-admin-secret:
// админ управляет пользователями ЛЮБОГО клиента, не только своего.
//
// GET    без ?slug=    — все пользователи всех клиентов (для сводной таблицы)
// GET    ?slug=acme    — пользователи одного клиента
// POST   { clientSlug, username, password, role, translatorName? } — создать
// PATCH  { clientSlug, username, password?, role?, translatorName? } — сброс
//        пароля и/или смены роли/ФИО; отсутствующие поля не трогаются
// DELETE { clientSlug, username } — удалить
//
// Валидация username/password/role — та же, что в api/client-users.js
// (не вынесена в общий модуль, чтобы не тянуть зависимость между api/* —
// оба файла маленькие и правятся редко, дублирование дешевле связности).
const USERNAME_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const ROLES = new Set(['owner', 'translator']);

function validateUsername(value) {
  return typeof value === 'string' && USERNAME_RE.test(value);
}
function validatePassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 200;
}
function validateTranslatorName(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= 200);
}
function validateClientSlug(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const auth = await checkAdminSecret(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }

  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.status(405).json({ error: 'Используйте GET, POST, PATCH или DELETE' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const slug = (req.query && req.query.slug || '').trim();
      const rows = slug ? await listClientUsers(slug) : await listAllClientUsers();
      res.status(200).json({
        users: rows.map(u => ({
          clientSlug: u.client_slug || slug,
          username: u.username,
          role: u.role,
          translatorName: u.translator_name || null,
          createdAt: u.created_at
        }))
      });
      return;
    }

    const body = req.body || {};

    if (req.method === 'POST') {
      if (!validateClientSlug(body.clientSlug)) {
        res.status(400).json({ error: 'Нужен clientSlug — тот же slug, что и у клиента (?client=slug).' });
        return;
      }
      if (!validateUsername(body.username)) {
        res.status(400).json({ error: 'Логин: латиница/цифры/_/- , до 100 символов.' });
        return;
      }
      if (!validatePassword(body.password)) {
        res.status(400).json({ error: 'Пароль должен быть строкой от 8 до 200 символов.' });
        return;
      }
      if (!ROLES.has(body.role)) {
        res.status(400).json({ error: 'Роль должна быть owner или translator.' });
        return;
      }
      if (!validateTranslatorName(body.translatorName)) {
        res.status(400).json({ error: 'translatorName должен быть строкой не длиннее 200 символов.' });
        return;
      }
      const clientSlug = body.clientSlug.trim();
      let created;
      try {
        created = await createClientUser({
          clientSlug, username: body.username, passwordHash: hashPassword(body.password),
          role: body.role, translatorName: body.translatorName || null
        });
      } catch (err) {
        if (String(err.message).includes('duplicate') || String(err.message).includes('unique')) {
          res.status(409).json({ error: 'Такой логин уже используется у этого клиента.' });
          return;
        }
        throw err;
      }
      res.status(201).json({ clientSlug, username: created.username, role: created.role, translatorName: created.translator_name || null });
      return;
    }

    if (req.method === 'PATCH') {
      if (!validateClientSlug(body.clientSlug) || !validateUsername(body.username)) {
        res.status(400).json({ error: 'Нужны корректные clientSlug и username.' });
        return;
      }
      const clientSlug = body.clientSlug.trim();
      const updates = {};
      if ('password' in body) {
        if (!validatePassword(body.password)) {
          res.status(400).json({ error: 'Пароль должен быть строкой от 8 до 200 символов.' });
          return;
        }
        updates.passwordHash = hashPassword(body.password);
      }
      if ('role' in body) {
        if (!ROLES.has(body.role)) {
          res.status(400).json({ error: 'Роль должна быть owner или translator.' });
          return;
        }
        if (body.role !== 'owner' && (await countOwners(clientSlug)) <= 1) {
          const owners = await listClientUsers(clientSlug);
          const isTheLastOwner = owners.some(u => u.username === body.username && u.role === 'owner');
          if (isTheLastOwner) {
            res.status(400).json({ error: 'Нельзя понизить последнего владельца — сначала назначьте другого.' });
            return;
          }
        }
        updates.role = body.role;
      }
      if ('translatorName' in body) {
        if (!validateTranslatorName(body.translatorName)) {
          res.status(400).json({ error: 'translatorName должен быть строкой не длиннее 200 символов.' });
          return;
        }
        updates.translatorName = body.translatorName;
      }
      if (!Object.keys(updates).length) {
        res.status(400).json({ error: 'Нечего сохранять — не передано ни одно из полей.' });
        return;
      }
      const updated = await updateClientUser(clientSlug, body.username, updates);
      if (!updated) {
        res.status(404).json({ error: 'Пользователь не найден.' });
        return;
      }
      res.status(200).json({ clientSlug, username: updated.username, role: updated.role, translatorName: updated.translator_name || null });
      return;
    }

    if (req.method === 'DELETE') {
      if (!validateClientSlug(body.clientSlug) || !validateUsername(body.username)) {
        res.status(400).json({ error: 'Нужны корректные clientSlug и username.' });
        return;
      }
      const clientSlug = body.clientSlug.trim();
      const owners = await listClientUsers(clientSlug);
      const target = owners.find(u => u.username === body.username);
      if (target && target.role === 'owner' && (await countOwners(clientSlug)) <= 1) {
        res.status(400).json({ error: 'Нельзя удалить последнего владельца.' });
        return;
      }
      const deleted = await deleteClientUser(clientSlug, body.username);
      if (!deleted) {
        res.status(404).json({ error: 'Пользователь не найден.' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
  } catch (err) {
    console.error('admin/client-users error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
