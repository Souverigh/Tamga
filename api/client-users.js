const { getClientConfig } = require('../lib/customFieldsLookup');
const { requireClientSettingsAuth, hashPassword } = require('../lib/clientAuth');
const { listClientUsers, createClientUser, updateClientUser, deleteClientUser, countOwners } = require('../lib/clientUsers');

// GET/POST/PATCH/DELETE /api/client-users?slug=acme — управление
// пользователями ОДНОГО клиента (Ethan, 17 сен 2026: "внутри клиента можно
// создать пользователей с разными ролями"). Только для роли 'owner' — тот
// же гейт, что и /api/client-settings, с той же проверкой роли (см. там же
// подробный комментарий про то, почему проверка именно здесь, а не внутри
// requireClientSettingsAuth).
//
// PATCH/DELETE адресуют пользователя по username в теле запроса — не по
// внутреннему id, чтобы не отдавать в браузер лишние технические детали.
//
// Пароль пользователя, как и пароль клиента (см. api/client-settings.js),
// хранится только хешем (lib/clientAuth.js:hashPassword). Логин (username)
// ограничен тем же набором символов, что и client_slug — безопасен как
// компонент подписанного токена (lib/clientAuth.js:signToken).
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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.status(405).json({ error: 'Используйте GET, POST, PATCH или DELETE' });
    return;
  }

  const clientSlug = (req.query && req.query.slug || '').trim();
  if (!clientSlug) {
    res.status(400).json({ error: 'Нужен ?slug=<client_slug>' });
    return;
  }

  try {
    const config = await getClientConfig({ clientSlug, fresh: true });
    const auth = await requireClientSettingsAuth({
      clientSlug,
      passwordHash: config ? config.passwordHash : null,
      token: req.headers['x-client-token']
    });
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    if (auth.role !== 'owner') {
      res.status(403).json({ error: 'Управление пользователями доступно только владельцу аккаунта.' });
      return;
    }

    if (req.method === 'GET') {
      const users = await listClientUsers(clientSlug);
      res.status(200).json({
        users: users.map(u => ({ username: u.username, role: u.role, translatorName: u.translator_name || null, createdAt: u.created_at }))
      });
      return;
    }

    const body = req.body || {};

    if (req.method === 'POST') {
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
      let created;
      try {
        created = await createClientUser({
          clientSlug, username: body.username, passwordHash: hashPassword(body.password),
          role: body.role, translatorName: body.translatorName || null
        });
      } catch (err) {
        // Уникальность (client_slug, username) обеспечена ограничением в БД —
        // отдельно не проверяем перед записью (гонка между проверкой и
        // записью была бы хуже одного понятного сообщения об ошибке здесь).
        if (String(err.message).includes('duplicate') || String(err.message).includes('unique')) {
          res.status(409).json({ error: 'Такой логин уже используется.' });
          return;
        }
        throw err;
      }
      res.status(201).json({ username: created.username, role: created.role, translatorName: created.translator_name || null });
      return;
    }

    if (req.method === 'PATCH') {
      if (!validateUsername(body.username)) {
        res.status(400).json({ error: 'Укажите корректный username.' });
        return;
      }
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
        // Нельзя разжаловать последнего владельца — иначе никто не сможет
        // управлять пользователями (включая обратное повышение в owner).
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
      res.status(200).json({ username: updated.username, role: updated.role, translatorName: updated.translator_name || null });
      return;
    }

    if (req.method === 'DELETE') {
      if (!validateUsername(body.username)) {
        res.status(400).json({ error: 'Укажите корректный username.' });
        return;
      }
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
    console.error('client-users error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
