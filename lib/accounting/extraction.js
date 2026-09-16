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
  // Keep every line-item column in the response. If a document does not
  // contain a column, the extraction instructions require an empty field
  // instead of allowing Gemini to omit the property entirely.
  required: ['description', 'quantity', 'unit', 'unit_price', 'amount', 'vat_rate', 'vat_amount']
};

// Плоские (не построчные) поля ЭСФ — §7 хендовера. Банковские реквизиты
// продавца (seller_bank_name/seller_bik/seller_account/
// seller_correspondent_account) и additional_notes добавлены 15 сен 2026
// (см. комментарий у ADDITIONAL_NOTES_GUIDANCE выше) — раньше не
// извлекались вообще.
const ESF_HEADER_FIELDS = [
  'invoice_number', 'invoice_date',
  'seller_name', 'seller_inn', 'seller_bank_name', 'seller_bik', 'seller_account', 'seller_correspondent_account',
  'buyer_name', 'buyer_inn',
  'subtotal', 'vat_rate', 'vat_total', 'total', 'currency',
  'additional_notes'
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

// Добавлено 15 сен 2026 (Ethan, дан диктовкой): раньше извлекались только
// поля, нужные для мат.проверок/экрана — реквизиты появления в договоре,
// подпись, печать, ссылка на договор терялись, бухгалтер шёл в оригинал
// руками. "additional_notes" — общий catch-all на свободный текст,
// одинаковый ключ во всех 4 типах (та же конвенция, что buyer_name/total/
// currency — общее по смыслу поле, не переименовывается по типу документа).
// Банковские реквизиты (БИК/банк/расчётный и корр. счёт), наоборот, СТРУКТУРНЫЕ
// поля — отдельно у ЭСФ/накладной/акта (Ethan, 15 сен 2026, "отдельными
// полями"), с префиксом соответствующей роли (seller_/supplier_/contractor_),
// т.к. они попадают в Excel-экспорт отдельной колонкой, а не текстом внутри
// abzаца — см. buildBankFieldsGuidance ниже. У платёжного поручения свои
// buyer_account/recipient_account уже были (расчётные счета сторон
// платежа) — банковские реквизиты там не дублируются.
const ADDITIONAL_NOTES_GUIDANCE = 'Also transcribe into "additional_notes" any other significant text on the document ' +
  'that does not fit the structured fields above — e.g. a signatory\'s printed name and position (not a description of ' +
  'the signature graphic itself), any stamp text if legible, a referenced contract number/date ("по Договору №... от ' +
  '..."), or other remarks/notes. If there is nothing else significant, leave it empty (value \'\', confidence 0).';

function buildBankFieldsGuidance(rolePrefix, roleLabel) {
  return `Also extract the ${roleLabel}'s bank requisites if shown on the document: "${rolePrefix}_bank_name" (the ` +
    `bank's name), "${rolePrefix}_bik" (БИК, the bank identifier code), "${rolePrefix}_account" (расчётный счёт, the ` +
    `${roleLabel}'s own settlement account number), and "${rolePrefix}_correspondent_account" (корреспондентский счёт, ` +
    'the bank\'s correspondent account). Leave any of these empty if not present on the document.';
}

function buildEsfExtractionInstruction() {
  return 'Extract structured data from this Счет-фактура / ЭСФ (VAT invoice) document, used for Kyrgyzstan business ' +
    'accounting. The document may be in Russian, Kyrgyz, or mixed. Extract seller and buyer names and INN (tax ID), ' +
    'invoice number and date, the line-items table, and document-level subtotal/VAT total/total. ' +
    `${FORMAT_GUIDANCE} ${MISSING_FIELD_GUIDANCE} ${ITEM_AMOUNT_GUIDANCE} ${CONFIDENCE_GUIDANCE} ` +
    `${buildBankFieldsGuidance('seller', 'seller')} ${ADDITIONAL_NOTES_GUIDANCE} ` +
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
  'supplier_name', 'supplier_inn', 'supplier_bank_name', 'supplier_bik', 'supplier_account', 'supplier_correspondent_account',
  'buyer_name', 'buyer_inn',
  'subtotal', 'vat_total', 'total', 'currency',
  'additional_notes'
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
    `${buildBankFieldsGuidance('supplier', 'supplier')} ${ADDITIONAL_NOTES_GUIDANCE} ` +
    'Every field must be reported as an object with "value", "raw_text", "page" (1-indexed page this value was read ' +
    'from), and "confidence" — never as a bare value. This document type has no per-line VAT rate field — leave ' +
    '"vat_rate" and "vat_amount" on each item empty (value \'\', confidence 0) unless the document explicitly shows them.';
}

// Акт выполненных работ (§21 Phase 4, добавлено 15 сен 2026 как второй из
// трёх оставшихся Phase-4-типов, после накладной). Строчные поля — тот же
// общий ESF_ITEM_SCHEMA, как и у накладной (см. комментарий в pipeline.js
// про одно общее свойство "items" в combinedSchema). Акт обычно не
// использует построчный vat_rate/vat_amount (как и накладная) — модель либо
// не заполнит их, либо заполнит, но buildActDoc их не использует, т.к.
// rules/act.js их не проверяет.
//
// buyer_name/buyer_inn переиспользуются как "заказчик" (та же смысловая
// роль, что "покупатель" у ЭСФ/накладной) — по конвенции из pipeline.js
// (эти два поля означают одно и то же у всех типов). Вторая сторона — не
// "продавец"/"поставщик", а "исполнитель" (contractor), т.к. акт про
// выполненные работы/услуги, а не про поставку товара — отдельные
// contractor_name/contractor_inn, не переиспользуют seller_*/supplier_*.
const ACT_HEADER_FIELDS = [
  'act_number', 'act_date',
  'contractor_name', 'contractor_inn', 'contractor_bank_name', 'contractor_bik', 'contractor_account', 'contractor_correspondent_account',
  'buyer_name', 'buyer_inn',
  'subtotal', 'vat_total', 'total', 'currency',
  'additional_notes'
];

function actSchemaProperties() {
  const properties = {};
  for (const key of ACT_HEADER_FIELDS) properties[key] = PROVENANCE_FIELD_SCHEMA;
  properties.items = { type: 'ARRAY', items: ESF_ITEM_SCHEMA };
  return properties;
}

function buildActExtractionInstruction() {
  return 'Extract structured data from this Акт выполненных работ / оказанных услуг (act of completed works or ' +
    'services) document, used for Kyrgyzstan business accounting. The document may be in Russian, Kyrgyz, or mixed. ' +
    'Extract the contractor (исполнитель) and customer (заказчик) names and INN (tax ID), act number and date, the ' +
    'line-items table (each line is a work or service performed — description, quantity, unit, unit price, line ' +
    'amount; quantity is often "1" with a unit like "услуга" or "работа" rather than a physical count), and ' +
    'document-level subtotal/VAT total/total. ' +
    `${FORMAT_GUIDANCE} ${MISSING_FIELD_GUIDANCE} ${ITEM_AMOUNT_GUIDANCE} ${CONFIDENCE_GUIDANCE} ` +
    `${buildBankFieldsGuidance('contractor', 'contractor')} ${ADDITIONAL_NOTES_GUIDANCE} ` +
    'Every field must be reported as an object with "value", "raw_text", "page" (1-indexed page this value was read ' +
    'from), and "confidence" — never as a bare value. This document type has no per-line VAT rate field — leave ' +
    '"vat_rate" and "vat_amount" on each item empty (value \'\', confidence 0) unless the document explicitly shows them.';
}

// Платёжное поручение (§21 Phase 4, добавлено 15 сен 2026 как третий и
// последний из Phase-4-типов). Структурно проще ЭСФ/накладной/акта: нет
// таблицы строк, поэтому нет "items" в schemaProperties здесь (в отличие от
// esfSchemaProperties/nakladnayaSchemaProperties/actSchemaProperties) — этот
// тип не добавляет своего ESF_ITEM_SCHEMA в combinedSchema, но т.к. другие
// типы его уже добавляют под тем же общим именем "items", поле "items" в
// комбинированной схеме всё равно присутствует; для платёжки модель просто
// не должна его заполнять (см. инструкцию ниже). buildPaymentOrderDoc
// (document.js) игнорирует items независимо от того, пришло что-то в нём
// или нет.
//
// buyer_name/buyer_inn — плательщик (тот, кто платит, как и у ЭСФ/накладной/
// акта). recipient_name/recipient_inn — получатель платежа, аналог seller/
// supplier/contractor по роли (получающая деньги сторона), но отдельные
// ключи: "получатель по платёжке" — не то же самое поле, что "продавец по
// счёту", даже если по факту одно и то же лицо на практике.
const PAYMENT_ORDER_HEADER_FIELDS = [
  'payment_order_number', 'payment_order_date',
  'buyer_name', 'buyer_inn', 'buyer_account',
  'recipient_name', 'recipient_inn', 'recipient_account',
  'total', 'currency', 'payment_purpose',
  'additional_notes'
];

function paymentOrderSchemaProperties() {
  const properties = {};
  for (const key of PAYMENT_ORDER_HEADER_FIELDS) properties[key] = PROVENANCE_FIELD_SCHEMA;
  return properties;
}

function buildPaymentOrderExtractionInstruction() {
  return 'Extract structured data from this Платёжное поручение (bank payment order) document, used for Kyrgyzstan ' +
    'business accounting. The document may be in Russian, Kyrgyz, or mixed. Extract the payment order number and ' +
    'date, the payer\'s name/INN/bank account, the recipient\'s name/INN/bank account, the payment purpose ' +
    '(назначение платежа, as free text), the payment amount, and the currency. This document type has NO line-items ' +
    'table and no subtotal/VAT breakdown — leave the "items" array empty. ' +
    `${FORMAT_GUIDANCE} ${MISSING_FIELD_GUIDANCE} ${CONFIDENCE_GUIDANCE} ${ADDITIONAL_NOTES_GUIDANCE} ` +
    'Every field must be reported as an object with "value", "raw_text", "page" (1-indexed page this value was read ' +
    'from), and "confidence" — never as a bare value. "payment_purpose" should be transcribed as free text, not ' +
    'reformatted like a date or amount.';
}

module.exports = {
  ESF_HEADER_FIELDS,
  PROVENANCE_FIELD_SCHEMA,
  ESF_ITEM_SCHEMA,
  esfSchemaProperties,
  buildEsfExtractionInstruction,
  NAKLADNAYA_HEADER_FIELDS,
  nakladnayaSchemaProperties,
  buildNakladnayaExtractionInstruction,
  ACT_HEADER_FIELDS,
  actSchemaProperties,
  buildActExtractionInstruction,
  PAYMENT_ORDER_HEADER_FIELDS,
  paymentOrderSchemaProperties,
  buildPaymentOrderExtractionInstruction
};
