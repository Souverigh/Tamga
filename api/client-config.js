const { getClientConfig } = require('../lib/customFieldsLookup');

// GET /api/client-config?slug=acme
//
// Отдаёт веб-интерфейсу ТОЛЬКО безопасную для браузера часть конфига клиента
// (см. lib/customFieldsLookup.js) — название компании, логотип, акцентный цвет
// для фасада, и отдельно НАЗВАНИЯ (не содержимое) кастомных типов документов —
// чтобы ручной выпадающий список типов мог их показать (см. public/js/ui/fileList.js,
// public/js/branding.js). Намеренно НЕ отдаёт fields/customDocTypes целиком/
// formatting — та часть конфига идёт в промпт Gemini только на сервере
// (см. lib/recognize.js), пользователю сайта незачем видеть содержимое
// промпта (поля, hints) в сетевой вкладке браузера.
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
      accentColor: config.accentColor,
      // Только названия кастомных типов — чтобы ручной выпадающий список типов
      // (см. public/js/ui/fileList.js) мог их показать. Сами поля/hints внутри
      // каждого типа остаются только на сервере (см. lib/extraction.js) —
      // пользователю сайта незачем видеть содержимое промпта в сетевой вкладке.
      customDocTypeNames: config.customDocTypes ? Object.keys(config.customDocTypes) : []
    });
  } catch (err) {
    // Fail-open — как и вся остальная кастомизация: сбой не должен мешать
    // человеку пользоваться сайтом, просто увидит брендинг по умолчанию.
    console.error('client-config error:', err);
    res.status(200).json({});
  }
};
