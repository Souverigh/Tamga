const { checkAdminSecret } = require('../../lib/adminAuth');
const { DOC_TYPES, isTableType } = require('../../lib/docSchema');

// Админский CRUD над tamga_api_key_fields (конфиги клиентов — см. customFieldsLookup.js) —
// заменяет ручную правку через Supabase Table Editor на простую форму (см. public/admin/).
//
// GET    /api/admin/clients            — список всех клиентов
// POST   /api/admin/clients            — создать нового клиента (тело — поля строки)
// PATCH  /api/admin/clients?id=<uuid>  — обновить существующего клиента
// DELETE /api/admin/clients?id=<uuid>  — удалить клиента
//
// Заголовок x-admin-secret обязателен на все методы (см. lib/adminAuth.js) —
// это внутренний инструмент, не публичный API и не веб-интерфейс сайта.
//
// Supabase REST используется напрямую через fetch (как и customFieldsLookup.js) —
// в проекте принципиально нет npm-зависимостей, клиентская библиотека не нужна.

const WRITABLE_COLUMNS = ['api_key', 'client_slug', 'label', 'fields', 'field_overrides', 'custom_doc_types', 'formatting', 'display_name', 'logo_url', 'accent_color'];

function supabaseHeaders(serviceKey, extra) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...extra };
}

// Нормализует и проверяет тело запроса перед записью — та же логика, что
// ограничение в БД (CHECK api_key IS NOT NULL OR client_slug IS NOT NULL),
// плюс проверка формы вложенных JSON-полей, чтобы явная ошибка админки была
// понятнее, чем невнятный 400 от PostgREST.
function validateAndNormalize(body) {
  const row = {};
  for (const col of WRITABLE_COLUMNS) {
    if (!(col in body)) continue;
    row[col] = body[col];
  }

  // Пустые строки трактуем как "не задано" — иначе легко случайно записать
  // '' вместо NULL из формы с пустым полем ввода.
  ['api_key', 'client_slug', 'label', 'display_name', 'logo_url', 'accent_color'].forEach(col => {
    if (row[col] === '') row[col] = null;
  });

  if (!row.api_key && !row.client_slug) {
    return { error: 'Нужно задать хотя бы api_key или client_slug — иначе на клиента не сослаться ни из API, ни из веб-интерфейса' };
  }

  if (row.fields !== undefined && row.fields !== null) {
    if (!Array.isArray(row.fields) || !row.fields.every(f => typeof f === 'string')) {
      return { error: 'fields должен быть массивом строк (названий полей) или пустым' };
    }
    if (!row.fields.length) row.fields = null;
  }

  if (row.field_overrides !== undefined && row.field_overrides !== null) {
    if (typeof row.field_overrides !== 'object' || Array.isArray(row.field_overrides)) {
      return { error: 'field_overrides должен быть объектом вида { "Название стандартного типа": ["Поле1", "Поле2"] }' };
    }
    for (const [type, fields] of Object.entries(row.field_overrides)) {
      if (!DOC_TYPES.includes(type)) {
        return { error: `field_overrides: "${type}" не входит в стандартный список типов документов` };
      }
      if (isTableType(type)) {
        return { error: `field_overrides: "${type}" — табличный тип, переопределение полей для него не поддерживается` };
      }
      if (!Array.isArray(fields) || !fields.every(f => typeof f === 'string') || !fields.length) {
        return { error: `field_overrides["${type}"] должен быть непустым массивом строк` };
      }
    }
    if (!Object.keys(row.field_overrides).length) row.field_overrides = null;
  }

  if (row.custom_doc_types !== undefined && row.custom_doc_types !== null) {
    if (typeof row.custom_doc_types !== 'object' || Array.isArray(row.custom_doc_types)) {
      return { error: 'custom_doc_types должен быть объектом вида { "Название типа": { "fields": ["Поле1"], "hint": "..." } }' };
    }
    for (const [type, entry] of Object.entries(row.custom_doc_types)) {
      if (DOC_TYPES.includes(type)) {
        return { error: `custom_doc_types: "${type}" совпадает со стандартным типом — используйте field_overrides для переопределения полей стандартного типа вместо кастомного типа с тем же именем` };
      }
      if (!entry || typeof entry !== 'object' || !Array.isArray(entry.fields) || !entry.fields.every(f => typeof f === 'string')) {
        return { error: `custom_doc_types["${type}"].fields должен быть массивом строк` };
      }
    }
    if (!Object.keys(row.custom_doc_types).length) row.custom_doc_types = null;
  }

  if (row.formatting !== undefined && row.formatting !== null) {
    const allowedDate = ['DD.MM.YYYY', 'YYYY-MM-DD'];
    const allowedSeparator = [',', '.'];
    if (typeof row.formatting !== 'object' || Array.isArray(row.formatting)) {
      return { error: 'formatting должен быть объектом { dateFormat, decimalSeparator }' };
    }
    if (row.formatting.dateFormat && !allowedDate.includes(row.formatting.dateFormat)) {
      return { error: `formatting.dateFormat должен быть одним из: ${allowedDate.join(', ')}` };
    }
    if (row.formatting.decimalSeparator && !allowedSeparator.includes(row.formatting.decimalSeparator)) {
      return { error: `formatting.decimalSeparator должен быть одним из: ${allowedSeparator.join(', ')}` };
    }
    if (!row.formatting.dateFormat && !row.formatting.decimalSeparator) row.formatting = null;
  }

  return { row };
}

module.exports = async (req, res) => {
  const auth = checkAdminSecret(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Supabase не настроен на сервере (нет SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }

  const id = req.query && req.query.id;

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${supabaseUrl}/rest/v1/tamga_api_key_fields?select=*&order=updated_at.desc`, {
        headers: supabaseHeaders(serviceKey)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
      res.status(200).json(data);
      return;
    }

    if (req.method === 'POST') {
      const { error, row } = validateAndNormalize(req.body || {});
      if (error) { res.status(400).json({ error }); return; }
      const r = await fetch(`${supabaseUrl}/rest/v1/tamga_api_key_fields`, {
        method: 'POST',
        headers: supabaseHeaders(serviceKey, { Prefer: 'return=representation' }),
        body: JSON.stringify(row)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
      res.status(201).json(Array.isArray(data) ? data[0] : data);
      return;
    }

    if (req.method === 'PATCH') {
      if (!id) { res.status(400).json({ error: 'Нужен ?id=<uuid> для обновления' }); return; }
      const { error, row } = validateAndNormalize(req.body || {});
      if (error) { res.status(400).json({ error }); return; }
      row.updated_at = new Date().toISOString();
      const r = await fetch(`${supabaseUrl}/rest/v1/tamga_api_key_fields?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: supabaseHeaders(serviceKey, { Prefer: 'return=representation' }),
        body: JSON.stringify(row)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
      if (!data.length) { res.status(404).json({ error: 'Клиент с таким id не найден' }); return; }
      res.status(200).json(data[0]);
      return;
    }

    if (req.method === 'DELETE') {
      if (!id) { res.status(400).json({ error: 'Нужен ?id=<uuid> для удаления' }); return; }
      const r = await fetch(`${supabaseUrl}/rest/v1/tamga_api_key_fields?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: supabaseHeaders(serviceKey)
      });
      if (!r.ok) { const data = await r.json().catch(() => null); throw new Error(data ? JSON.stringify(data) : `Supabase вернул ${r.status}`); }
      res.status(204).end();
      return;
    }

    res.status(405).json({ error: 'Метод не поддерживается' });
  } catch (err) {
    console.error('admin/clients error:', err);
    res.status(500).json({ error: 'Ошибка Supabase: ' + err.message });
  }
};
