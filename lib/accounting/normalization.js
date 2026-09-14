// Нормализация значений перед проверкой правил — §6 хендовера.
// ОТДЕЛЬНЫЙ модуль от lib/fieldFormat.js (тот заточен под формат старого
// пайплайна распознавания и его набор типов документов; здесь своя, более
// строгая нормализация специально под детерминированные бухгалтерские
// проверки, где допустить NaN в проверку опаснее, чем не нормализовать поле).
//
// Важно: raw_text сохраняется всегда отдельно (см. extraction.js) — эти
// функции только парсят "value" в число/ISO-дату для rules/engine.js,
// исходный текст они не трогают и не заменяют.

// "12 500,00 сом" / "12,500.00 KGS" / "12500.00" → 12500
function parseAmount(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[^\d,.\-\s]/g, '').replace(/\s/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    s = s.replace(',', '.');
  }

  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

// "12%" / "0.12" / "12" → 0.12  (heuristic: values > 1 are treated as percent-points)
function parsePercent(value) {
  if (value == null) return null;
  const s = String(value).trim().replace('%', '').replace(',', '.');
  if (!s) return null;
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  return num > 1 ? num / 100 : num;
}

// Accepts YYYY-MM-DD (expected, per extraction.js FORMAT_GUIDANCE), DD.MM.YYYY,
// DD/MM/YYYY as a fallback in case the model doesn't follow instructions.
// Returns ISO string YYYY-MM-DD or null — never guesses on ambiguous input.
function parseDate(value) {
  if (!value) return null;
  const v = String(value).trim();

  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return v;

  m = v.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

// result — the raw {value, raw_text, page, confidence} object from Gemini
// (see PROVENANCE_FIELD_SCHEMA in extraction.js). kind selects the parser.
// Returns null (not a value) when the field is empty/unparseable — callers
// must treat null as INSUFFICIENT_DATA, never as 0.
function normalizedValue(field, kind) {
  if (!field || field.value === '' || field.value == null) return null;
  if (kind === 'amount') return parseAmount(field.value);
  if (kind === 'percent') return parsePercent(field.value);
  if (kind === 'date') return parseDate(field.value);
  return field.value;
}

module.exports = { parseAmount, parsePercent, parseDate, normalizedValue };
