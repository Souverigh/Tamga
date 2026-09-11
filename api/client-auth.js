const { getClientConfig } = require('../lib/customFieldsLookup');
const { verifyPassword, signToken } = require('../lib/clientAuth');
const { checkClientAuthRateLimit, recordClientAuthFailure } = require('../lib/authRateLimit');
const { extractClientIp } = require('../lib/anonymousUsage');

// POST /api/client-auth  { clientSlug, password }
//
// Проверяет пароль доступа к сайту клиентского пилота (см. lib/clientAuth.js,
// задаётся через /admin) и в случае успеха выдаёт подписанный токен — его
// фронтенд (public/js/branding.js) кладёт в sessionStorage и дальше прикладывает
// к /api/client-config и /api/recognize (см. эти файлы: без валидного токена
// на этот же slug оба отказывают).
//
// Намеренно НЕ сообщает разницу между "клиент не найден", "пароль не задан"
// и "неверный пароль" — везде один и тот же ответ 401 с общим текстом, чтобы
// не давать угадывающему пароль лишней информации о том, существует ли вообще
// такой slug или защищён ли он паролем.
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

  const { clientSlug, password } = req.body || {};
  const genericError = { error: 'Неверный slug или пароль' };

  if (!clientSlug || typeof clientSlug !== 'string' || !password || typeof password !== 'string') {
    res.status(400).json({ error: 'Нужны clientSlug и password' });
    return;
  }

  const clientIp = extractClientIp(req);
  const rateLimit = await checkClientAuthRateLimit({ clientSlug, ip: clientIp });
  if (!rateLimit.allowed) {
    res.status(rateLimit.unavailable ? 503 : 429).json({ error: 'Слишком много попыток входа, попробуйте позже', retryAfterSeconds: rateLimit.retryAfterSeconds });
    return;
  }

  try {
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
    res.status(200).json({ token });
  } catch (err) {
    console.error('client-auth error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
