const crypto = require('crypto');
const { checkAdminSecret } = require('../../lib/adminAuth');
const { hashPassword } = require('../../lib/clientAuth');
const { clearConfigCache } = require('../../lib/customFieldsLookup');
const { validateFieldOverrides, validateCustomDocTypes, validateBusinessRules } = require('../../lib/clientConfigValidation');

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

const WRITABLE_COLUMNS = ['api_key', 'client_slug', 'label', 'fields', 'field_overrides', 'custom_doc_types', 'formatting', 'display_name', 'logo_url', 'accent_color', 'page_limit', 'pages_used'];
// access_password_hash НЕ в WRITABLE_COLUMNS — админка никогда не пишет туда
// напрямую. Вместо этого тело запроса может содержать 'access_password'
// (plaintext, только на вход) — validateAndNormalize хеширует его сюда же
// (см. lib/clientAuth.js), или 'remove_access_password: true' — снять пароль.
// Ни то, ни другое не колонка сама по себе, поэтому оба обрабатываются отдельно
// от общего цикла по WRITABLE_COLUMNS ниже (см. validateAndNormalize).

function supabaseHeaders(serviceKey, extra) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...extra };
}

// access_password_hash никогда не должен попадать в браузер — даже как хеш:
// незачем облегчать офлайн-подбор пароля тому, кто получит доступ к сетевой
// вкладке. Вместо этого отдаём только факт "пароль задан" (has_password).
// Используется и для GET (список), и для ответа POST/PATCH (return=representation).
function sanitizeClientRow(row) {
  const { access_password_hash, ...rest } = row;
  return { ...rest, has_password: !!access_password_hash };
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

  // Пароль гейта сайта (см. lib/clientAuth.js) — на входе всегда plaintext,
  // хешируем перед записью, plaintext дальше нигде не хранится и не логируется.
  // 'access_password' и 'remove_access_password' — взаимоисключающие сигналы:
  // задать новый пароль или явно снять существующий. Отсутствие обоих —
  // "не трогать" (PATCH не должен молча стирать пароль, если форма его просто
  // не прислала, см. admin.js: поле всегда пустое при открытии карточки).
  if (body.access_password) {
    if (typeof body.access_password !== 'string' || body.access_password.length < 8) {
      return { error: 'Пароль доступа к сайту должен быть строкой не короче 8 символов' };
    }
    row.access_password_hash = hashPassword(body.access_password);
  } else if (body.remove_access_password) {
    row.access_password_hash = null;
  }

  if (row.fields !== undefined && row.fields !== null) {
    if (!Array.isArray(row.fields) || !row.fields.every(f => typeof f === 'string')) {
      return { error: 'fields должен быть массивом строк (названий полей) или пустым' };
    }
    if (!row.fields.length) row.fields = null;
  }

  // Для табличных типов (накладная/УПД, справочник номенклатуры и т.д.) массив
  // значений — это НАЗВАНИЯ КОЛОНОК, а не подписи полей label/value; ключи в
  // JSON-ответе для них генерируются автоматически (col0, col1, ...), см.
  // lib/extraction.js:resolveTableColumns. Формат override один и тот же
  // (массив строк) для карточных и табличных типов — различие только в том,
  // как этот массив интерпретируется дальше по пайплайну. Валидация — общая
  // с api/client-settings.js, см. lib/clientConfigValidation.js.
  if (row.field_overrides !== undefined) {
    const { error, value } = validateFieldOverrides(row.field_overrides);
    if (error) return { error };
    row.field_overrides = value;
  }

  if (row.custom_doc_types !== undefined) {
    const { error, value } = validateCustomDocTypes(row.custom_doc_types);
    if (error) return { error };
    row.custom_doc_types = value;
  }

  if (row.formatting !== undefined && row.formatting !== null) {
    if (row.formatting.includeText !== undefined && typeof row.formatting.includeText !== 'boolean') {
      return { error: 'formatting.includeText должен быть true или false' };
    }
    const allowedDate = ['DD.MM.YYYY', 'YYYY-MM-DD'];
    const allowedSeparator = [',', '.'];
    if (typeof row.formatting !== 'object' || Array.isArray(row.formatting)) {
      return { error: 'formatting должен быть объектом { dateFormat, decimalSeparator, maxConcurrency }' };
    }
    if (row.formatting.dateFormat && !allowedDate.includes(row.formatting.dateFormat)) {
      return { error: `formatting.dateFormat должен быть одним из: ${allowedDate.join(', ')}` };
    }
    if (row.formatting.decimalSeparator && !allowedSeparator.includes(row.formatting.decimalSeparator)) {
      return { error: `formatting.decimalSeparator должен быть одним из: ${allowedSeparator.join(', ')}` };
    }
    // Приоритетная обработка (см. lib/customFieldsLookup.js:getClientConfig —
    // диапазон 1-60 зажимается там же ещё раз при чтении, здесь проверяем
    // сразу на записи ради понятной ошибки в форме админки, а не молчаливого
    // игнорирования кривого значения при следующем распознавании).
    if (row.formatting.maxConcurrency !== undefined && row.formatting.maxConcurrency !== null && row.formatting.maxConcurrency !== '') {
      const n = Number(row.formatting.maxConcurrency);
      if (!Number.isInteger(n) || n < 1 || n > 60) {
        return { error: 'formatting.maxConcurrency должен быть целым числом от 1 до 60' };
      }
      row.formatting.maxConcurrency = n;
    } else {
      delete row.formatting.maxConcurrency;
    }
    // Вебхук "пакет завершён" (см. api/v1/batch.js, lib/webhooks.js). URL
    // обязательно https:// — секрет отправляется по нему в виде подписи,
    // http сделал бы её бессмысленной (перехватывается вместе с телом).
    if (row.formatting.webhookUrl !== undefined && row.formatting.webhookUrl !== null && row.formatting.webhookUrl !== '') {
      const url = String(row.formatting.webhookUrl).trim();
      if (!/^https:\/\/.+/.test(url)) {
        return { error: 'formatting.webhookUrl должен начинаться с https://' };
      }
      try { require('../../lib/safeWebhook').validateWebhookUrl(url); } catch (_) { return { error: 'Вебхук требует публичный HTTPS-адрес без пароля, порт 443' }; }
      row.formatting.webhookUrl = url;
      // Секрет для подписи (X-Tamga-Signature) — если URL задан, а секрет нет,
      // генерируем сами: пусть подпись есть по умолчанию, а не только если
      // администратор вспомнит её задать вручную. Показывается в ответе формы
      // (см. sanitizeClientRow — только access_password_hash скрывается, это
      // внутренний инструмент для самого Ethan, не self-service клиентов).
      if (!row.formatting.webhookSecret) {
        row.formatting.webhookSecret = crypto.randomBytes(24).toString('hex');
      }
    } else {
      // Нет URL — секрет без него бессмысленен, чистим оба вместе.
      delete row.formatting.webhookUrl;
      delete row.formatting.webhookSecret;
    }
    // Настраиваемые бизнес-правила (Ethan, 7 сен 2026) — валидация общая с
    // api/client-settings.js, см. lib/clientConfigValidation.js. ВАЖНО: этой
    // проверки не хватало изначально (8 сен 2026, найдено при подготовке
    // самообслуживания клиентов) — сохранение клиента БЕЗ других полей
    // formatting (дата/разделитель/приоритет/вебхук) тихо стирало уже
    // сохранённые бизнес-правила, см. предупреждение ниже про "те же грабли".
    if (row.formatting.businessRules !== undefined) {
      const { error, value } = validateBusinessRules(row.formatting.businessRules);
      if (error) return { error };
      if (value.length) row.formatting.businessRules = value;
      else delete row.formatting.businessRules;
    }
    // ВАЖНО: должно перечислять ВСЕ поддерживаемые ключи formatting — раньше
    // здесь проверялись только dateFormat/decimalSeparator, из-за чего
    // formatting с ЕДИНСТВЕННО заданным maxConcurrency (без даты/разделителя)
    // тихо схлопывался в null и настройка приоритета никогда бы не сохранялась.
    // webhookUrl добавлен в этот же список по той же причине — не наступать
    // на те же грабли второй раз. businessRules был здесь пропущен и наступил
    // на те же грабли в третий раз (см. комментарий выше) — добавлен сейчас.
    if (!row.formatting.dateFormat && !row.formatting.decimalSeparator && !row.formatting.maxConcurrency
        && !row.formatting.webhookUrl && !(row.formatting.businessRules && row.formatting.businessRules.length)
        && row.formatting.includeText === undefined) {
      row.formatting = null;
    }
  }

  // Разовый пакет страниц (см. lib/customFieldsLookup.js:consumeUsage). Пустая
  // строка из поля ввода -> null (без лимита), не 0 — иначе форма с очищенным
  // полем случайно заблокировала бы клиента на нулевом лимите вместо снятия лимита.
  if (row.page_limit === '') row.page_limit = null;
  if (row.page_limit !== undefined && row.page_limit !== null) {
    const n = Number(row.page_limit);
    if (!Number.isInteger(n) || n < 0) {
      return { error: 'page_limit должен быть целым неотрицательным числом или пустым (без лимита)' };
    }
    row.page_limit = n;
  }
  if (row.pages_used !== undefined) {
    const n = Number(row.pages_used);
    if (!Number.isInteger(n) || n < 0) {
      return { error: 'pages_used должен быть целым неотрицательным числом' };
    }
    row.pages_used = n;
  }

  return { row };
}

module.exports = async (req, res) => {
  const auth = await checkAdminSecret(req);
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
      res.status(200).json(data.map(sanitizeClientRow));
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
      clearConfigCache(); // новый клиент — следующий же recognize должен увидеть его настройки, не ждать TTL
      res.status(201).json(sanitizeClientRow(Array.isArray(data) ? data[0] : data));
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
      // Сброс кэша важен и для пароля гейта: если PATCH сменил/снял пароль,
      // следующая попытка входа на сайт не должна ещё минуту проверяться
      // по старому хешу из кэша.
      clearConfigCache();
      res.status(200).json(sanitizeClientRow(data[0]));
      return;
    }

    if (req.method === 'DELETE') {
      if (!id) { res.status(400).json({ error: 'Нужен ?id=<uuid> для удаления' }); return; }
      const r = await fetch(`${supabaseUrl}/rest/v1/tamga_api_key_fields?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: supabaseHeaders(serviceKey)
      });
      if (!r.ok) { const data = await r.json().catch(() => null); throw new Error(data ? JSON.stringify(data) : `Supabase вернул ${r.status}`); }
      clearConfigCache(); // удалённый клиент не должен продолжать обслуживаться (включая гейт) из кэша ещё минуту
      res.status(204).end();
      return;
    }

    res.status(405).json({ error: 'Метод не поддерживается' });
  } catch (err) {
    console.error('admin/clients error:', err);
    res.status(500).json({ error: 'Ошибка Supabase: ' + err.message });
  }
};
