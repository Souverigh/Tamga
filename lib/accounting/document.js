// Собирает единый объект документа для rules/*.js из сырого ответа Gemini
// (провенанс-поля, см. extraction.js) — считает нормализованные значения
// один раз, а не в каждом правиле по отдельности.
//
// doc.header / doc.items — сырые provenance-поля {value, raw_text, page, confidence}.
// doc.normalized — те же данные, но value прогнан через normalization.js
// (числа/ISO-даты или null, если распознать не удалось — null ПОКАЗЫВАЕТ
// правилам, что нужно вернуть INSUFFICIENT_DATA, а не 0/ошибочный расчёт).

const { normalizedValue } = require('./normalization');

const AMOUNT_KEYS = new Set(['subtotal', 'vat_total', 'total', 'unit_price', 'amount', 'vat_amount', 'quantity']);
const PERCENT_KEYS = new Set(['vat_rate']);
const DATE_KEYS = new Set(['invoice_date']);

function kindFor(key) {
  if (AMOUNT_KEYS.has(key)) return 'amount';
  if (PERCENT_KEYS.has(key)) return 'percent';
  if (DATE_KEYS.has(key)) return 'date';
  return 'text';
}

function normalizeRecord(record) {
  const out = {};
  for (const [key, field] of Object.entries(record || {})) {
    out[key] = normalizedValue(field, kindFor(key));
  }
  return out;
}

function buildEsfDoc(rawExtraction) {
  const header = rawExtraction.header || {};
  const items = Array.isArray(rawExtraction.items) ? rawExtraction.items : [];
  return {
    header,
    items,
    normalized: {
      header: normalizeRecord(header),
      items: items.map(normalizeRecord)
    }
  };
}

module.exports = { buildEsfDoc };
