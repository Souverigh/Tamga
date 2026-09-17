// Двухуровневый глоссарий транслитераций ФИО/топонимов (перестроен 17 сен
// 2026 по запросу Ethan — заменяет прежнюю схему "общий словарь,
// last-write-wins"):
//
//  1) У каждого клиента — своя персональная запись (tamga_glossary_client_terms,
//     одна строка на клиента на original_key). Если клиент правил термин —
//     в ЕГО переводах всегда используется именно его вариант, независимо от
//     того, что видят остальные.
//  2) Общий дефолт (tamga_verified_transliterations, та же таблица, что и
//     раньше) — то, что видит клиент, который термин ещё НИ РАЗУ не
//     подтверждал сам. Вычисляется как большинство: значение, которое
//     выбрало больше всего РАЗНЫХ клиентов среди tamga_glossary_client_terms
//     (при ничьей — то, что появилось раньше, см. upsert_client_glossary_term
//     в БД). Первый клиент, подтвердивший термин, тем самым задаёт
//     начальный общий дефолт (большинство из одного голоса); если позже
//     большинство платных клиентов сойдётся на другом варианте — общий
//     дефолт сам переключится на него.
//
// Ключ — нормализованный (без учёта регистра и пробелов по краям) оригинал
// на кириллице.
//
// Тот же fail-safe принцип, что usageAnalytics.js/documentTemplates.js —
// недоступность словаря НИКОГДА не должна сломать сам перевод: при сбое
// просто используется обычная transliterate() как раньше (см. model.mjs).

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

async function callRpc(fnName, args) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { ok: false, reason: 'not_configured', rows: [] };
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args)
    });
    if (!res.ok) {
      console.error(`verifiedTransliterations: ${fnName} вернул`, res.status);
      return { ok: false, reason: 'error', rows: [] };
    }
    const rows = await res.json();
    return { ok: true, rows: Array.isArray(rows) ? rows : [rows] };
  } catch (err) {
    console.error(`verifiedTransliterations: ошибка запроса ${fnName}:`, err.message);
    return { ok: false, reason: 'error', rows: [] };
  }
}

// originals — сырые значения (кириллица) с формы, до 50 штук за раз (то же
// ограничение, что у сегментов перевода, см. api/transliterations.js).
// clientSlug — валидированный слаг платного клиента (см. requirePaidTranslationClient).
// Возвращает { [исходное значение]: проверенный вариант } ТОЛЬКО для
// найденных — для остальных вызывающий код (panel.js) использует обычную
// transliterate() как раньше. Личная правка клиента всегда важнее общего
// дефолта; общий дефолт подставляется только для терминов, которые ЭТОТ
// клиент ещё сам не подтверждал.
async function lookupTransliterations(clientSlug, originals) {
  const keys = [...new Set((originals || []).map(normalizeKey).filter(Boolean))];
  if (!keys.length) return {};

  const [clientOutcome, globalOutcome] = await Promise.all([
    clientSlug ? callRpc('get_client_glossary_terms', { p_client_slug: clientSlug, p_original_keys: keys }) : { ok: false, rows: [] },
    callRpc('get_verified_transliterations', { p_original_keys: keys })
  ]);

  const byKey = {};
  if (globalOutcome.ok) {
    for (const row of globalOutcome.rows) {
      if (row && row.original_key) byKey[row.original_key] = row.verified_value;
    }
  }
  // Личные записи клиента перекрывают общий дефолт для тех же ключей.
  if (clientOutcome.ok) {
    for (const row of clientOutcome.rows) {
      if (row && row.original_key) byKey[row.original_key] = row.verified_value;
    }
  }

  const result = {};
  for (const original of originals || []) {
    const key = normalizeKey(original);
    if (byKey[key] !== undefined) result[original] = byKey[key];
  }
  return result;
}

// Записывает одно подтверждение — клиент вручную поправил (или оставил
// осознанно) значение поля транслитерации перед экспортом. Всегда пишется
// в ЕГО персональную запись (tamga_glossary_client_terms); общий дефолт
// пересчитывается по большинству внутри БД-функции upsert_client_glossary_term.
async function recordTransliteration(clientSlug, original, verifiedValue) {
  const key = normalizeKey(original);
  const value = String(verifiedValue || '').trim();
  if (!clientSlug || !key || !value) return { ok: false, reason: 'empty' };
  const outcome = await callRpc('upsert_client_glossary_term', {
    p_client_slug: clientSlug,
    p_original_key: key,
    p_original_sample: String(original).trim(),
    p_verified_value: value
  });
  if (!outcome.ok) return { ok: false };
  const row = outcome.rows[0] || {};
  return { ok: true, globalChanged: row.out_global_changed === true, globalValue: row.out_global_value };
}

// Страница управления глоссарием (клиент просматривает/правит термины
// заранее, не только в момент перевода документа). search — подстрока по
// оригиналу ИЛИ по значению (ILIKE, регистронезависимо). Возвращает и общее
// количество для пагинации.
async function listGlossaryTerms(clientSlug, { search = '', limit = 50, offset = 0 } = {}) {
  const [listOutcome, countOutcome] = await Promise.all([
    callRpc('list_glossary_terms', { p_client_slug: clientSlug || '', p_search: search || null, p_limit: limit, p_offset: offset }),
    callRpc('count_glossary_terms', { p_search: search || null })
  ]);
  if (!listOutcome.ok) return { ok: false, items: [], total: 0 };
  const items = listOutcome.rows.map(row => ({
    original: row.original_sample,
    globalValue: row.global_value,
    globalVotes: row.global_confirmed_count,
    clientValue: row.client_value ?? null,
    updatedAt: row.updated_at
  }));
  const total = countOutcome.ok && typeof countOutcome.rows[0] === 'number'
    ? countOutcome.rows[0]
    : (countOutcome.ok ? countOutcome.rows[0] : items.length);
  return { ok: true, items, total: typeof total === 'number' ? total : items.length };
}

module.exports = { lookupTransliterations, recordTransliteration, listGlossaryTerms, normalizeKey };
