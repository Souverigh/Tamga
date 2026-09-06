const { getClientConfig } = require('../lib/customFieldsLookup');
const { verifyPassword, signToken } = require('../lib/clientAuth');

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

  try {
    const config = await getClientConfig({ clientSlug });
    if (!config || !config.passwordHash || !verifyPassword(password, config.passwordHash)) {
      res.status(401).json(genericError);
      return;
    }
    const token = signToken(clientSlug);
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
