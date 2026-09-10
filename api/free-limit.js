const { currentDailyLimit } = require('../lib/anonymousUsage');

// GET /api/free-limit — публичная, без авторизации (не персональные данные,
// просто текущее число страниц в день для бесплатного тарифа). Ethan, 9 сен
// 2026: "пока раскручиваемся, нужно временно 20 страниц в день" — читается
// из lib/anonymousUsage.js:currentDailyLimit(), которая сама смотрит
// переменную окружения TAMGA_FREE_DAILY_PAGE_LIMIT. Нужен отдельным
// эндпоинтом, чтобы баннер на главной странице (public/index.html/app.js)
// показывал АКТУАЛЬНОЕ число — при откате лимита назад через Vercel
// (без передеплоя кода) текст на сайте обновится сам, не понадобится ещё
// один коммит только чтобы поправить цифру в тексте.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте GET' });
    return;
  }
  res.status(200).json({ dailyLimit: currentDailyLimit() });
};
