// Общий (между всеми клиентами — Ethan, 13 сен 2026, "общий давай") словарь
// проверенных транслитераций ФИО/топонимов. Ключ — нормализованный (без учёта
// регистра и пробелов по краям) оригинал на кириллице, значение — последний
// ПОДТВЕРЖДЁННЫЙ вариант латиницей (клиент вручную поправил через
// nameOverrides, см. public/js/translation/panel.js:confirmNameOverrides).
// Одна и та же орфография оригинала => одна и та же проверенная
// транслитерация для всех клиентов — сознательный выбор (быстрее растёт
// база, типовые кыргызские топонимы и частые фамилии выравниваются между
// клиентами, а не остаются приватной копией каждого).
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
// Возвращает { [исходное значение]: проверенный вариант } ТОЛЬКО для
// найденных — для остальных вызывающий код (panel.js) использует обычную
// transliterate() как раньше.
async function lookupTransliterations(originals) {
  const keys = [...new Set((originals || []).map(normalizeKey).filter(Boolean))];
  if (!keys.length) return {};
  const outcome = await callRpc('get_verified_transliterations', { p_original_keys: keys });
  if (!outcome.ok) return {};
  const byKey = {};
  for (const row of outcome.rows) {
    if (row && row.original_key) byKey[row.original_key] = row.verified_value;
  }
  const result = {};
  for (const original of originals || []) {
    const key = normalizeKey(original);
    if (byKey[key] !== undefined) result[original] = byKey[key];
  }
  return result;
}

// Записывает одно подтверждение — клиент вручную поправил (или оставил
// осознанно) значение поля транслитерации перед экспортом. См. миграцию
// upsert_verified_transliteration для правила на расхождение значений.
async function recordTransliteration(original, verifiedValue) {
  const key = normalizeKey(original);
  const value = String(verifiedValue || '').trim();
  if (!key || !value) return { ok: false, reason: 'empty' };
  const outcome = await callRpc('upsert_verified_transliteration', {
    p_original_key: key,
    p_original_sample: String(original).trim(),
    p_verified_value: value
  });
  return { ok: outcome.ok };
}

module.exports = { lookupTransliterations, recordTransliteration, normalizeKey };
