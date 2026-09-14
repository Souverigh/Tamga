// Библиотека шаблонов документов — накопление структурных сигнатур уже
// распознанных документов (Ethan, 13 сен 2026, "система шаблонов документов",
// чтобы конкурент с голым вызовом Gemini не мог повторить с той же
// точностью без такого же объёма реальных клиентских бланков).
//
// Фаза 1 (эта реализация): только ЗАПИСЬ — после каждого успешного
// извлечения с непустыми fields считаем структурную сигнатуру (fingerprint)
// и копим её в tamga_document_templates (миграция create_document_templates).
// Промпт Gemini на этом этапе НЕ меняется — извлечение работает как раньше.
// Фаза 2 (см. TECH_DEBT.md, "Открыто") — когда на fingerprint наберётся
// достаточно образцов, использовать field_hints как подсказку ДО вызова
// Gemini, чтобы поднять точность/снизить неоднозначность на повторяющихся
// бланках. Не сделано намеренно — это отдельная задача, тут только фундамент.
//
// Тот же fail-safe принцип, что usageAnalytics.js/webhookBatches.js: сбой
// записи НИКОГДА не должен повлиять на ответ распознавания.
//
// Область (client_slug в таблице) переиспользует usageClientRef из
// recognize.js (apiKey либо clientSlug — см. её комментарий) — та же
// логика "один канал, значит одна область", что уже принята для аналитики
// (usageAnalytics.js). null означает общий/анонимный шаблон — сделано
// намеренно: один и тот же типовой бланк (например, счёт-фактура КР)
// полезно узнавать между разными клиентами, а не держать в одиночных
// приватных копиях.
//
// Приватность: field_hints хранит ТОЛЬКО подписи полей (лейблы), никогда
// значения — значения принадлежат чужому документу и не должны утекать в
// общий шаблон.

const crypto = require('crypto');

const CJK_RANGE = /[\u4e00-\u9fff]/;
const KY_LETTERS = /[ңүөҢҮӨ]/;
const CYRILLIC_RANGE = /[а-яА-ЯёЁ]/;

// Грубая эвристика по уже извлечённым подписям/значениям — отдельного
// vision-запроса на язык не делаем, этого достаточно, чтобы не путать между
// собой русские, кыргызские, английские и китайские бланки одного doc_type.
function detectLang(fields) {
  const sample = (fields || []).map(f => `${f.label || ''} ${f.value || ''}`).join(' ');
  if (CJK_RANGE.test(sample)) return 'zh';
  if (KY_LETTERS.test(sample)) return 'ky';
  if (CYRILLIC_RANGE.test(sample)) return 'ru';
  return 'en';
}

// Структурная сигнатура — НЕ содержимое документа, только doc_type + состав
// подписей полей (отсортированные, без учёта регистра). Два разных
// документа одного и того же бланка дают один fingerprint независимо от
// значений — то, что и нужно, чтобы узнавать ПОВТОРЯЮЩИЙСЯ формат.
function computeFingerprint(docType, fields) {
  const labels = (fields || [])
    .map(f => (f.label || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
  const raw = `${docType || ''}|${labels.join('|')}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

async function callRpc(fnName, args) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { ok: false, reason: 'not_configured' };
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
      console.error(`documentTemplates: ${fnName} вернул`, res.status);
      return { ok: false, reason: 'error' };
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row ? { ok: true, row } : { ok: false, reason: 'error' };
  } catch (err) {
    console.error(`documentTemplates: ошибка запроса ${fnName}:`, err.message);
    return { ok: false, reason: 'error' };
  }
}

// Записывает/обновляет один шаблон. Пропускает документы без полей —
// табличные типы без totals (см. recognize.js) не дают fields вообще, там
// сравнивать нечего на этой фазе.
async function recordDocumentTemplate({ clientRef, docType, fields, confidence }) {
  if (!docType || !Array.isArray(fields) || !fields.length) return { ok: false, reason: 'no_fields' };
  const fingerprint = computeFingerprint(docType, fields);
  const lang = detectLang(fields);
  const fieldHints = { labels: fields.map(f => f.label).filter(Boolean) };
  const outcome = await callRpc('upsert_document_template', {
    p_client_slug: clientRef || null,
    p_doc_type: docType,
    p_lang: lang,
    p_fingerprint: fingerprint,
    p_field_hints: fieldHints,
    p_confidence: confidence == null ? null : confidence
  });
  return { ok: outcome.ok, reason: outcome.reason || null };
}

module.exports = { recordDocumentTemplate, computeFingerprint, detectLang };
