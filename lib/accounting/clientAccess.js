// Гейт для клиентской веб-панели бухгалтерии (public/js/accounting/panel.js,
// api/accounting/client-recognize.js, api/accounting/client-export.js) —
// добавлено 15 сен 2026, когда Ethan попросил открыть модуль платным
// клиентам Tamga. Копирует паттерн lib/translationAccess.js:
// requirePaidTranslationClient — та же логика ("настроенный клиент = платный
// пакет", requireClientSettingsAuth строже обычного checkClientGate, чтобы
// знание slug само по себе не открывало премиум-функцию без токена) — здесь
// не переиспользуется напрямую, а скопирована в отдельный файл, по тому же
// принципу, что и lib/accounting/apiKeyAuth.js отдельно от lib/apiKeyAuth.js:
// у бухгалтерского модуля свой периметр файлов, даже когда логика совпадает.
const { getClientConfig } = require('../customFieldsLookup');
const { requireClientSettingsAuth } = require('../clientAuth');

async function requirePaidAccountingClient(req, slug) {
  if (!slug) throw Object.assign(new Error('Модуль бухгалтерии доступен только платным клиентам после входа.'), { status: 403 });
  if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) throw Object.assign(new Error('Некорректный клиент.'), { status: 400 });
  const config = await getClientConfig({ clientSlug: slug, fresh: true });
  if (!config) throw Object.assign(new Error('Для модуля бухгалтерии необходим платный клиентский пакет.'), { status: 403 });
  const gate = requireClientSettingsAuth({ clientSlug: slug, passwordHash: config.passwordHash, token: req.headers?.['x-client-token'] });
  if (!gate.ok) throw Object.assign(new Error(gate.message), { status: gate.status });
  return slug;
}

module.exports = { requirePaidAccountingClient };
