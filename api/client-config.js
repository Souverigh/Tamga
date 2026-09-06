const { getClientConfig } = require('../lib/customFieldsLookup');
const { checkClientGate } = require('../lib/clientAuth');

// GET /api/client-config?slug=acme
// Заголовок x-client-token — токен гейта (см. lib/clientAuth.js), нужен только
// если у клиента задан пароль доступа к сайту (см. ниже).
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
// Если у клиента задан пароль (access_password_hash в Supabase, см. /admin) —
// без валидного x-client-token отвечаем 401 { gateRequired: true } и НЕ отдаём
// вообще ничего из фасада (даже display_name) — иначе гейт всего сайта имел бы
// смысл, но фасад всё равно бы утекал любому, кто знает slug. См. branding.js:
// именно по 401+gateRequired фронтенд показывает форму пароля.
//
// Отсутствие slug или ненайденный/пустой/без-пароля конфиг — не ошибка:
// возвращаем {} и фронтенд просто использует брендинг по умолчанию (см. branding.js).
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

    const gate = checkClientGate({ clientSlug: slug, passwordHash: config.passwordHash, token: req.headers['x-client-token'] });
    if (!gate.ok) {
      res.status(gate.status).json({ gateRequired: true, error: gate.message });
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
    // Это НЕ распространяется на сам гейт паролем выше (checkClientGate
    // фейлит закрыто) — этот catch ловит только неожиданные ошибки (например,
    // сбой Supabase), а не осознанный отказ по паролю.
    console.error('client-config error:', err);
    res.status(200).json({});
  }
};
