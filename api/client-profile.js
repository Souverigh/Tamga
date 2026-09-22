const { getClientConfig } = require('../lib/customFieldsLookup');
const { checkClientGate } = require('../lib/clientAuth');
const { updateClientUser } = require('../lib/clientUsers');

// GET/PATCH /api/client-profile?slug=acme — самообслуживание СВОЕЙ ЖЕ
// учётной записи (Ethan, 21 сен 2026: "чтобы переводчики сами могли
// изменить, иметь свой вариант приписки" — в отличие от api/client-settings.js
// (только owner, правит ОБЩИЕ настройки клиента) и api/client-users.js
// (только owner, правит ЛЮБОГО пользователя) — этот эндпоинт доступен
// ЛЮБОЙ роли (owner или translator), но только для СВОЕЙ записи: username
// берётся из токена (auth.username), НИКОГДА из тела запроса — иначе
// переводчик мог бы поправить чужую приписку, подставив её username.
//
// Личный вариант приписки (certification: companyName/taxId/registrationId/
// address/phone/email) — те же поля, что у общей приписки клиента
// (formatting.certification, см. api/client-settings.js), но персонально на
// пользователя. Пустой/не заданный — панель (public/js/translationDocs/panel.js)
// использует общий вариант клиента, как раньше.
//
// Легаси-клиенты без отдельных пользователей (auth.username === '') сюда
// прийти не могут — своей персональной записи нет, править нечего; у них
// есть только общие настройки клиента через api/client-settings.js.
const CERTIFICATION_KEYS = ['companyName', 'taxId', 'registrationId', 'address', 'phone', 'email'];

function validateTranslatorName(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= 200);
}
function validateCertification(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: {} };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  const out = {};
  for (const key of CERTIFICATION_KEYS) {
    if (value[key] === undefined || value[key] === null) continue;
    if (typeof value[key] !== 'string' || value[key].length > 300) return { ok: false };
    if (value[key].trim()) out[key] = value[key].trim();
  }
  return { ok: true, value: out };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.status(405).json({ error: 'Используйте GET или PATCH' });
    return;
  }

  const clientSlug = (req.query && req.query.slug || '').trim();
  if (!clientSlug) {
    res.status(400).json({ error: 'Нужен ?slug=<client_slug>' });
    return;
  }

  try {
    const config = await getClientConfig({ clientSlug, fresh: true });
    const auth = await checkClientGate({
      clientSlug,
      passwordHash: config ? config.passwordHash : null,
      token: req.headers['x-client-token']
    });
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    if (!auth.username) {
      res.status(400).json({ error: 'У вашей учётной записи нет персонального профиля — используйте общие настройки клиента.' });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({
        username: auth.username,
        role: auth.role,
        translatorName: auth.translatorName || null,
        certification: auth.certification || {}
      });
      return;
    }

    const body = req.body || {};
    const updates = {};
    if ('translatorName' in body) {
      if (!validateTranslatorName(body.translatorName)) {
        res.status(400).json({ error: 'translatorName должен быть строкой не длиннее 200 символов.' });
        return;
      }
      updates.translatorName = body.translatorName;
    }
    if ('certification' in body) {
      const { ok, value } = validateCertification(body.certification);
      if (!ok) {
        res.status(400).json({ error: 'certification должен быть объектом со строковыми полями не длиннее 300 символов.' });
        return;
      }
      updates.certification = value;
    }
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: 'Нечего сохранять — не передано ни одно из полей.' });
      return;
    }

    const updated = await updateClientUser(clientSlug, auth.username, updates);
    if (!updated) {
      res.status(404).json({ error: 'Учётная запись не найдена.' });
      return;
    }
    res.status(200).json({
      username: updated.username,
      role: updated.role,
      translatorName: updated.translator_name || null,
      certification: updated.certification || {}
    });
  } catch (err) {
    console.error('client-profile error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
