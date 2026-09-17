const { getClientConfig } = require('../lib/customFieldsLookup');
const { verifyPassword, signToken } = require('../lib/clientAuth');
const { hasClientUsers, getClientUser } = require('../lib/clientUsers');
const { checkClientAuthRateLimit, recordClientAuthFailure } = require('../lib/authRateLimit');
const { extractClientIp } = require('../lib/anonymousUsage');

// POST /api/client-auth  { clientSlug, password, username? }
//
// Перестроено 17 сен 2026 (Ethan: пользователи внутри клиента, свой логин у
// каждого) — раньше проверялся ровно один пароль клиента. Теперь два пути:
//   - у клиента ЕЩЁ НЕТ ни одного пользователя (lib/clientUsers.js) —
//     легаси-путь, ровно как раньше: только password, сверяется с
//     access_password_hash клиента, токен без привязки к конкретному
//     человеку (роль всегда 'owner', см. lib/clientAuth.js:resolveIdentity).
//   - у клиента ЕСТЬ хотя бы один пользователь — нужен ещё и username,
//     сверяется с его личным password_hash (tamga_client_users). Если
//     username не передан, а он нужен — отдельный код USERNAME_REQUIRED,
//     чтобы фронтенд (public/js/branding.js) показал поле логина и
//     переспросил, не пугая обычным "неверный пароль".
//
// Намеренно НЕ сообщает разницу между "клиент/пользователь не найден" и
// "неверный пароль" — везде один и тот же ответ 401 с общим текстом, чтобы
// не давать угадывающему пароль лишней информации о том, существует ли
// вообще такой slug/логин.
//
// Троттлинг попыток (Ethan, 7 сен 2026, аудит безопасности) — см.
// lib/authRateLimit.js: до 5 неудачных попыток за 15 минут на пару (slug, IP).
// Проверка лимита — ДО сравнения пароля (заблокированный запрос не тратит
// scrypt впустую), запись неудачи — ТОЛЬКО когда пароль оказался неверным.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  const { clientSlug, password, username } = req.body || {};
  const genericError = { error: 'Неверный логин или пароль' };

  if (!clientSlug || typeof clientSlug !== 'string' || !password || typeof password !== 'string') {
    res.status(400).json({ error: 'Нужны clientSlug и password' });
    return;
  }
  if (username !== undefined && (typeof username !== 'string' || username.length > 100)) {
    res.status(400).json({ error: 'Некорректный логин' });
    return;
  }

  const clientIp = extractClientIp(req);
  const rateLimit = await checkClientAuthRateLimit({ clientSlug, ip: clientIp });
  if (!rateLimit.allowed) {
    res.status(rateLimit.unavailable ? 503 : 429).json({ error: 'Слишком много попыток входа, попробуйте позже', retryAfterSeconds: rateLimit.retryAfterSeconds });
    return;
  }

  try {
    const usersExist = await hasClientUsers(clientSlug);

    if (usersExist) {
      const trimmedUsername = (username || '').trim();
      if (!trimmedUsername) {
        res.status(400).json({ error: 'Укажите логин', code: 'USERNAME_REQUIRED' });
        return;
      }
      const user = await getClientUser(clientSlug, trimmedUsername);
      if (!user || !verifyPassword(password, user.password_hash)) {
        await recordClientAuthFailure({ clientSlug, ip: clientIp });
        res.status(401).json(genericError);
        return;
      }
      const token = signToken(clientSlug, user.password_hash, user.username);
      if (!token) {
        res.status(500).json({ error: 'Сервер не настроен для выдачи токенов (нет TAMGA_CLIENT_AUTH_SECRET)' });
        return;
      }
      res.status(200).json({ token, role: user.role, translatorName: user.translator_name || null });
      return;
    }

    // Легаси-путь — как раньше, без отдельных пользователей.
    const config = await getClientConfig({ clientSlug, fresh: true });
    if (!config || !config.passwordHash || !verifyPassword(password, config.passwordHash)) {
      await recordClientAuthFailure({ clientSlug, ip: clientIp });
      res.status(401).json(genericError);
      return;
    }
    const token = signToken(clientSlug, config.passwordHash);
    if (!token) {
      res.status(500).json({ error: 'Сервер не настроен для выдачи токенов (нет TAMGA_CLIENT_AUTH_SECRET)' });
      return;
    }
    res.status(200).json({ token, role: 'owner', translatorName: null });
  } catch (err) {
    console.error('client-auth error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
