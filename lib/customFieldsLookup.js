// Ищет кастомный список полей извлечения для конкретного API-ключа бизнеса
// (таблица tamga_api_key_fields в Supabase — см. миграцию create_tamga_api_key_fields).
//
// ВАЖНО: используется только на пути публичного API (api/v1/recognize.js) —
// веб-интерфейс никогда не передаёт apiKey в recognizeDocument(), так что
// это никак не влияет на поведение по умолчанию для обычных пользователей сайта.
//
// Fail-open по конструкции: если Supabase не настроен (нет переменных окружения),
// недоступен, вернул ошибку, или для ключа просто нет строки — функция возвращает
// null, и recognizeDocument() продолжает работать со стандартным списком полей
// для типа документа, как раньше. Кастомизация — это опциональное улучшение,
// а не точка отказа: её сбой не должен ронять распознавание для интеграции.
async function getCustomFields(apiKey) {
  if (!apiKey) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null; // кастомизация просто не настроена — это нормально

  try {
    const url = `${supabaseUrl}/rest/v1/tamga_api_key_fields?api_key=eq.${encodeURIComponent(apiKey)}&select=fields`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      }
    });
    if (!res.ok) {
      console.error('customFieldsLookup: Supabase вернул', res.status, '— используем поля по умолчанию');
      return null;
    }
    const rows = await res.json();
    const fields = rows && rows[0] && Array.isArray(rows[0].fields) ? rows[0].fields : null;
    return fields && fields.length ? fields : null;
  } catch (err) {
    console.error('customFieldsLookup: ошибка запроса к Supabase, используем поля по умолчанию:', err.message);
    return null;
  }
}

module.exports = { getCustomFields };
