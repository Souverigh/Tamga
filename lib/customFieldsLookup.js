// Ищет конфигурацию клиента в Supabase (таблица tamga_api_key_fields) — по
// API-ключу (интеграции, api/v1/recognize.js) или по client_slug (веб-интерфейс,
// см. index.html/app.js — ?client=acme или /acme через rewrite).
//
// Изначально таблица хранила только кастомный список полей per API-ключ —
// теперь строка может нести весь конфиг клиента: кастомные поля, кастомные
// типы документов, форматирование значений, white-label фасад (логотип/
// название/цвет). Строку можно адресовать по api_key и/или client_slug —
// одна и та же запись может обслуживать и API-интеграцию, и веб-доступ клиента.
//
// Fail-open по конструкции везде: если Supabase не настроен (нет переменных
// окружения), недоступен, вернул ошибку, или для ключа/slug просто нет строки —
// функция возвращает null, и вызывающий код продолжает работать по умолчанию,
// как для обычного пользователя без кастомизации. Кастомизация — это
// опциональное улучшение, а не точка отказа: её сбой не должен ронять
// распознавание ни для интеграции, ни для веб-интерфейса.

// access_password_hash — только для сервера (гейт сайта по slug, см.
// lib/clientAuth.js) — НИКОГДА не должен уходить в ответ браузеру
// (api/client-config.js его не отдаёт, только использует для проверки).
const SELECT_COLUMNS = 'fields,field_overrides,custom_doc_types,formatting,display_name,logo_url,accent_color,access_password_hash';

// In-memory кэш строк конфига — экономит повторные обращения к Supabase при
// пакетной обработке: пачка из 50 файлов одного клиента без кэша дала бы
// 50 одинаковых запросов подряд (recognizeDocument вызывается на КАЖДУЮ
// страницу), хотя ответ на всю пачку один и тот же. Кэшируются только
// НАСТРОЙКИ клиента (список полей, форматирование, фасад, хеш пароля) —
// содержимое самих обрабатываемых документов сюда никогда не попадает.
//
// TTL короткий (60 секунд) — реальной экономии на пачке из десятков файлов
// это уже даёт большую часть пользы, а разница между "поменял настройку в
// админке" и "она применилась" в худшем случае — одна минута. Плюс явный
// сброс кэша при сохранении в админке (см. clearConfigCache, api/admin/clients.js) —
// так изменение (включая смену/снятие пароля) применяется мгновенно.
//
// Живёт в памяти процесса serverless-функции — работает, пока Vercel
// переиспользует тот же тёплый инстанс (Fluid Compute), не является общим
// между разными инстансами/регионами. Это ожидаемое ограничение, не баг:
// распределённый кэш (Redis и т.п.) избыточен для текущего объёма.
const CACHE_TTL_MS = 60 * 1000;
const configCache = new Map(); // `${column}:${value}` -> { value: row|null, expiresAt }

function getCached(key) {
  const entry = configCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    configCache.delete(key);
    return undefined;
  }
  return entry.value;
}

// Кэшируется только УСПЕШНЫЙ ответ Supabase (строка найдена — либо точно
// не найдена). Ошибки и сетевые сбои НЕ кэшируются намеренно: временная
// проблема с Supabase не должна "залипать" на минуту.
async function fetchConfigRow(column, value) {
  const cacheKey = `${column}:${value}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null; // кастомизация просто не настроена — это нормально, не кэшируем

  try {
    const url = `${supabaseUrl}/rest/v1/tamga_api_key_fields?${column}=eq.${encodeURIComponent(value)}&select=${SELECT_COLUMNS}`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      }
    });
    if (!res.ok) {
      console.error('customFieldsLookup: Supabase вернул', res.status, '— используем настройки по умолчанию');
      return null;
    }
    const rows = await res.json();
    const result = rows && rows[0] ? rows[0] : null;
    configCache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    console.error('customFieldsLookup: ошибка запроса к Supabase, используем настройки по умолчанию:', err.message);
    return null;
  }
}

// Сбрасывает кэш целиком — вызывается после любого изменения в админке
// (см. api/admin/clients.js), включая смену/снятие пароля доступа: гейт
// не должен продолжать пускать/не пускать по старому паролю ещё минуту.
function clearConfigCache() {
  configCache.clear();
}

// Разовый пакет страниц (page_limit/pages_used, см. миграцию tamga_add_page_usage_limit)
// — атомарная проверка лимита + инкремент ОДНИМ запросом через Postgres-функцию
// consume_page_usage (SELECT ... FOR UPDATE внутри неё блокирует строку клиента
// на время вызова). Это НАМЕРЕННО отдельная функция от fetchConfigRow выше и
// НИКОГДА не кэшируется, в отличие от остального конфига клиента — использование
// обязано проверяться заново на каждый вызов, иначе кэш в 60 секунд позволил бы
// клиенту проскочить далеко за лимит при пакетной обработке.
//
// Возвращает { allowed, pagesUsed, pageLimit }. При отсутствии Supabase-конфигурации
// или сетевом сбое — fail-OPEN (allowed: true): недоступность биллинг-инфраструктуры
// не должна останавливать распознавание для клиента, у которого лимит вообще не
// настроен (подавляющее большинство) — тот же принцип, что и во всём остальном модуле.
async function consumeUsage({ apiKey, clientSlug }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { allowed: true, pagesUsed: 0, pageLimit: null };

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_page_usage`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_api_key: apiKey || null, p_client_slug: clientSlug || null })
    });
    if (!res.ok) {
      console.error('consumeUsage: Supabase RPC вернул', res.status, '— пропускаем без учёта лимита');
      return { allowed: true, pagesUsed: 0, pageLimit: null };
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { allowed: !!row.allowed, pagesUsed: row.pages_used, pageLimit: row.page_limit };
  } catch (err) {
    console.error('consumeUsage: ошибка запроса к Supabase, пропускаем без учёта лимита:', err.message);
    return { allowed: true, pagesUsed: 0, pageLimit: null };
  }
}

// Сохранено для обратной совместимости и как более лёгкий путь, когда нужен
// только список полей (см. lib/extraction.js). Возвращает null, если полей
// нет или конфиг не найден — как и раньше.
async function getCustomFields(apiKey) {
  if (!apiKey) return null;
  const row = await fetchConfigRow('api_key', apiKey);
  const fields = row && Array.isArray(row.fields) ? row.fields : null;
  return fields && fields.length ? fields : null;
}

// Полный конфиг клиента — используется recognize.js (customDocTypes,
// formatting) и API-эндпоинтом фасада для веб-интерфейса (display_name,
// logo_url, accent_color). identifier — { apiKey } или { clientSlug }, ровно
// один из них должен быть задан вызывающим кодом.
async function getClientConfig({ apiKey, clientSlug } = {}) {
  const row = apiKey
    ? await fetchConfigRow('api_key', apiKey)
    : clientSlug
      ? await fetchConfigRow('client_slug', clientSlug)
      : null;
  if (!row) return null;

  const fields = Array.isArray(row.fields) && row.fields.length ? row.fields : null;
  const fieldOverrides = row.field_overrides && typeof row.field_overrides === 'object' && Object.keys(row.field_overrides).length ? row.field_overrides : null;
  const customDocTypes = row.custom_doc_types && typeof row.custom_doc_types === 'object' ? row.custom_doc_types : null;
  const formatting = row.formatting && typeof row.formatting === 'object' ? row.formatting : null;
  const passwordHash = row.access_password_hash || null;

  // Если конфиг нашёлся, но абсолютно пустой (ни полей, ни переопределений,
  // ни кастомных типов, ни форматирования, ни фасада, ни пароля) — ведём себя
  // так же, как если бы строки не было вовсе: нет смысла считать "найден, но
  // ничего не задано" особым случаем.
  if (!fields && !fieldOverrides && !customDocTypes && !formatting && !row.display_name && !row.logo_url && !row.accent_color && !passwordHash) {
    return null;
  }

  return {
    fields,
    fieldOverrides,
    customDocTypes,
    formatting,
    displayName: row.display_name || null,
    logoUrl: row.logo_url || null,
    accentColor: row.accent_color || null,
    // Используется ТОЛЬКО lib/clientAuth.js (см. api/client-config.js,
    // api/recognize.js) — никогда не попадает в ответ браузеру напрямую.
    passwordHash
  };
}

module.exports = { getCustomFields, getClientConfig, clearConfigCache, consumeUsage };
