// Извлечение полей ЭСФ — независимый модуль, отдельный от lib/extraction.js.
//
// Отличие от общего пайплайна Tamga (lib/extraction.js + lib/confidence.js):
// хендовер (§5) требует provenance НА КАЖДОЕ важное поле — value, raw_text,
// page, confidence, а не только document-level или per-field confidence без
// raw_text, как в существующем пайплайне. Поэтому здесь отдельная схема
// ответа Gemini, а не переиспользование FIELD_CONFIDENCE_GUIDANCE.
//
// bounding_box из §5 сознательно НЕ реализован в этом первом срезе — Gemini
// structured output не даёт надёжных координат без отдельного vision-grounding
// вызова; строка "source location" в проекте пока = page (для многостраничных
// документов) + сам факт хранения raw_text (достаточно, чтобы найти значение
// глазами). Зафиксировать как открытый пункт при расширении.

const PROVENANCE_FIELD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    value: { type: 'STRING' },      // нормализованное значение (см. normalization.js)
    raw_text: { type: 'STRING' },   // как написано в документе, без нормализации
    page: { type: 'INTEGER' },
    confidence: { type: 'INTEGER' } // 0-100, тот же критерий, что в lib/confidence.js
  },
  required: ['value', 'raw_text', 'page', 'confidence']
};

const ESF_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    description: PROVENANCE_FIELD_SCHEMA,
    quantity: PROVENANCE_FIELD_SCHEMA,
    unit: PROVENANCE_FIELD_SCHEMA,
    unit_price: PROVENANCE_FIELD_SCHEMA,
    amount: PROVENANCE_FIELD_SCHEMA,
    vat_rate: PROVENANCE_FIELD_SCHEMA,
    vat_amount: PROVENANCE_FIELD_SCHEMA
  },
  required: ['description', 'quantity', 'unit_price', 'amount']
};

// Плоские (не построчные) поля ЭСФ — §7 хендовера.
const ESF_HEADER_FIELDS = [
  'invoice_number', 'invoice_date',
  'seller_name', 'seller_inn',
  'buyer_name', 'buyer_inn',
  'subtotal', 'vat_rate', 'vat_total', 'total', 'currency'
];

function esfSchemaProperties() {
  const properties = {};
  for (const key of ESF_HEADER_FIELDS) properties[key] = PROVENANCE_FIELD_SCHEMA;
  properties.items = { type: 'ARRAY', items: ESF_ITEM_SCHEMA };
  return properties;
}

const FORMAT_GUIDANCE = 'For "value", format every date as YYYY-MM-DD and every amount as a plain number with a dot as ' +
  'decimal separator, no thousands separators, no currency symbols (e.g. "12500.00"). For "raw_text", transcribe the ' +
  'value exactly as printed on the document, unformatted. "vat_rate" value should be a decimal fraction (e.g. "0.12" for 12%).';

const MISSING_FIELD_GUIDANCE = 'If a field is genuinely absent from the document, set its "value" to an empty string and ' +
  '"confidence" to 0 — never invent a value that is not indicated anywhere in the document. Never guess seller/buyer INN ' +
  'from context; only report a value actually printed on the document.';

// Диагностировано 14 сен 2026 (Ethan, документ 01_ESF_goods_valid_single):
// без этого уточнения модель иногда путает построчную "amount" с колонкой
// "Всего"/"Итого" по строке (сумма С НДС), если в таблице есть обе колонки —
// "Сумма без НДС" и "Всего" одновременно. Результат: amount оказывается
// равен line total-with-VAT вместо line subtotal, и INV-002/INV-003 ложно
// срабатывают на корректном документе, потому что qty×price (=subtotal) не
// совпадает с тем, что модель ошибочно записала в amount.
const ITEM_AMOUNT_GUIDANCE = 'A line item\'s table row may show MULTIPLE total-like columns — e.g. both a pre-VAT line ' +
  'subtotal (often labeled "Сумма без НДС", "Сумма", "Стоимость") and a VAT-inclusive line total (often labeled ' +
  '"Всего", "Итого", "Сумма с НДС", usually the rightmost column). The "amount" field is ALWAYS the pre-VAT line ' +
  'subtotal — it should equal quantity × unit_price for that line — and must NEVER be the VAT-inclusive column, even ' +
  'if that column is visually more prominent or further right in the table. Report any VAT-inclusive per-line total ' +
  'only via "vat_amount" (the VAT portion alone, not the inclusive total) if the document breaks it out separately; ' +
  'otherwise leave "vat_amount" empty.';

const CONFIDENCE_GUIDANCE = 'For every field (including each line item field), rate confidence 0-100 that the value is ' +
  'complete and correct, using the same criteria in each case: lower it for blurry/illegible/cut-off source, ambiguous ' +
  'handwriting, or any value you had to guess. A clearly printed, unambiguous value should score above 90.';

function buildEsfExtractionInstruction() {
  return 'Extract structured data from this Счет-фактура / ЭСФ (VAT invoice) document, used for Kyrgyzstan business ' +
    'accounting. The document may be in Russian, Kyrgyz, or mixed. Extract seller and buyer names and INN (tax ID), ' +
    'invoice number and date, the line-items table, and document-level subtotal/VAT total/total. ' +
    `${FORMAT_GUIDANCE} ${MISSING_FIELD_GUIDANCE} ${ITEM_AMOUNT_GUIDANCE} ${CONFIDENCE_GUIDANCE} ` +
    'Every field must be reported as an object with "value", "raw_text", "page" (1-indexed page this value was read ' +
    'from), and "confidence" — never as a bare value.';
}

// Товарная накладная (§8 хендовера, добавлено 14 сен 2026 как первый
// Phase-4-тип). Строчные поля — тот же ESF_ITEM_SCHEMA (description/quantity/
// unit/unit_price/amount/vat_rate/vat_amount): schema свойства "items" одна
// общая на оба типа в combinedSchema (pipeline.js), т.к. Gemini-схема не
// позволяет иметь две разные схемы под одним именем массива при классификации
// одним вызовом. Накладная просто не использует vat_rate/vat_amount построчно
// (её правила их не проверяют, см. rules/nakladnaya.js) — лишние с точки
// зрения накладной поля модель либо не заполнит, либо заполнит, но они
// игнорируются при сборке doc через buildNakladnayaDoc.
const NAKLADNAYA_HEADER_FIELDS = [
  'delivery_note_number', 'delivery_note_date',
  'supplier_name', 'supplier_inn',
  'buyer_name', 'buyer_inn',
  'subtotal', 'vat_total', 'total', 'currency'
];

function nakladnayaSchemaProperties() {
  const properties = {};
  for (const key of NAKLADNAYA_HEADER_FIELDS) properties[key] = PROVENANCE_FIELD_SCHEMA;
  properties.items = { type: 'ARRAY', items: ESF_ITEM_SCHEMA };
  return properties;
}

function buildNakladnayaExtractionInstruction() {
  return 'Extract structured data from this Товарная накладная (goods delivery note) document, used for Kyrgyzstan ' +
    'business accounting. The document may be in Russian, Kyrgyz, or mixed. Extract supplier and buyer names and INN ' +
    '(tax ID), delivery note number and date, the line-items table (goods, quantity, unit, unit price, line amount), ' +
    'and document-level subtotal/VAT total/total. ' +
    `${FORMAT_GUIDANCE} ${MISSING_FIELD_GUIDANCE} ${ITEM_AMOUNT_GUIDANCE} ${CONFIDENCE_GUIDANCE} ` +
    'Every field must be reported as an object with "value", "raw_text", "page" (1-indexed page this value was read ' +
    'from), and "confidence" — never as a bare value. This document type has no per-line VAT rate field — leave ' +
    '"vat_rate" and "vat_amount" on each item empty (value \'\', confidence 0) unless the document explicitly shows them.';
}

module.exports = {
  ESF_HEADER_FIELDS,
  PROVENANCE_FIELD_SCHEMA,
  ESF_ITEM_SCHEMA,
  esfSchemaProperties,
  buildEsfExtractionInstruction,
  NAKLADNAYA_HEADER_FIELDS,
  nakladnayaSchemaProperties,
  buildNakladnayaExtractionInstruction
};
