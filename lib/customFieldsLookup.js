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

const SELECT_COLUMNS = 'fields,custom_doc_types,formatting,display_name,logo_url,accent_color';

async function fetchConfigRow(column, value) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null; // кастомизация просто не настроена — это нормально

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
    return rows && rows[0] ? rows[0] : null;
  } catch (err) {
    console.error('customFieldsLookup: ошибка запроса к Supabase, используем настройки по умолчанию:', err.message);
    return null;
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
  const customDocTypes = row.custom_doc_types && typeof row.custom_doc_types === 'object' ? row.custom_doc_types : null;
  const formatting = row.formatting && typeof row.formatting === 'object' ? row.formatting : null;

  // Если конфиг нашёлся, но абсолютно пустой (ни полей, ни кастомных типов,
  // ни форматирования, ни фасада) — ведём себя так же, как если бы строки не
  // было вовсе: нет смысла считать "найден, но ничего не задано" особым случаем.
  if (!fields && !customDocTypes && !formatting && !row.display_name && !row.logo_url && !row.accent_color) {
    return null;
  }

  return {
    fields,
    customDocTypes,
    formatting,
    displayName: row.display_name || null,
    logoUrl: row.logo_url || null,
    accentColor: row.accent_color || null
  };
}

module.exports = { getCustomFields, getClientConfig };
