// Словарь фиксированных юридических/нотариальных формулировок — отдельно от
// tamga_verified_transliterations/tamga_glossary_client_terms (те — только
// ФИО/топонимы, персональный выбор клиента). Этот словарь НЕ привязан к
// клиенту: устоявшиеся клише ("нотариально удостоверено", "вступает в силу
// с момента подписания" и т.п.) должны переводиться одинаково для всех.
// Сидинг и правки — через миграции/SQL, не через клиентский UI (в отличие
// от ФИО-глоссария, который клиент правит сам).
//
// Тот же fail-safe принцип, что и у verifiedTransliterations.js: недоступность
// словаря никогда не должна ронять сам перевод — при сбое translateSegments()
// просто переводит как раньше, без глоссарных подсказок.

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
      console.error(`legalPhrases: ${fnName} вернул`, res.status);
      return { ok: false, reason: 'error', rows: [] };
    }
    const rows = await res.json();
    return { ok: true, rows: Array.isArray(rows) ? rows : [rows] };
  } catch (err) {
    console.error(`legalPhrases: ошибка запроса ${fnName}:`, err.message);
    return { ok: false, reason: 'error', rows: [] };
  }
}

// texts — массив исходных текстов сегментов (до 50, как и сами сегменты
// перевода). Возвращает:
//  - exact: { [segmentText]: { translatedValue, needsReview } } — сегмент
//    ЦЕЛИКОМ совпадает с известной формулировкой; вызывающий код может
//    подставить перевод напрямую, не отправляя сегмент в Gemini.
//  - hints: [{ source, translated, needsReview }] — формулировки, которые
//    встречаются ВНУТРИ более длинного сегмента; используются только как
//    подсказка глоссария в промпте Gemini, не как прямая замена.
async function lookupLegalPhrases(language, texts) {
  const list = (texts || []).filter(t => typeof t === 'string' && t.trim());
  if (!list.length) return { exact: {}, hints: [] };

  const outcome = await callRpc('get_legal_phrases', { p_target_language: language, p_segment_texts: list });
  if (!outcome.ok) return { exact: {}, hints: [] };

  const normalize = v => String(v || '').trim().toLowerCase();
  const exact = {};
  const hints = [];
  const seenHint = new Set();
  for (const row of outcome.rows) {
    if (!row || !row.source_key || !row.translated_value) continue;
    if (row.match_type === 'exact') {
      const text = list.find(t => normalize(t) === row.source_key);
      if (text) exact[text] = { translatedValue: row.translated_value, needsReview: row.needs_review !== false };
    } else if (!seenHint.has(row.source_key)) {
      seenHint.add(row.source_key);
      hints.push({ source: row.source_sample || row.source_key, translated: row.translated_value, needsReview: row.needs_review !== false });
    }
  }
  return { exact, hints };
}

module.exports = { lookupLegalPhrases };
