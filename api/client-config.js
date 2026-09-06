const { getClientConfig } = require('../lib/customFieldsLookup');

// GET /api/client-config?slug=acme
//
// Отдаёт веб-интерфейсу ТОЛЬКО публичную, безопасную для браузера часть
// конфига клиента (см. lib/customFieldsLookup.js) — название компании, логотип,
// акцентный цвет для фасада (?client=acme в URL, см. public/js/branding.js).
// Намеренно НЕ отдаёт fields/customDocTypes/formatting — та часть конфига идёт
// в промпт Gemini только на сервере (см. lib/recognize.js), пользователю сайта
// незачем её видеть в сетевой вкладке браузера.
//
// Отсутствие slug или ненайденный/пустой конфиг — не ошибка: возвращаем {}
// и фронтенд просто использует брендинг по умолчанию (см. branding.js).
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте GET' });
    return;
  }

  const slug = (req.query && req.query.slug || '').trim();
  if (!slug) {
    res.status(200).json({});
    return;
  }

  try {
    const config = await getClientConfig({ clientSlug: slug });
    if (!config) {
      res.status(200).json({});
      return;
    }
    res.status(200).json({
      displayName: config.displayName,
      logoUrl: config.logoUrl,
      accentColor: config.accentColor
    });
  } catch (err) {
    // Fail-open — как и вся остальная кастомизация: сбой не должен мешать
    // человеку пользоваться сайтом, просто увидит брендинг по умолчанию.
    console.error('client-config error:', err);
    res.status(200).json({});
  }
};
