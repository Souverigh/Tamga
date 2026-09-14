// Классификация бухгалтерского документа — по образцу lib/classification.js,
// но читает только lib/accounting/docSchema.js (ACCOUNTING_DOC_TYPES), не
// пересекается со старым DOC_TYPES.
//
// Пока в ACCOUNTING_DOC_TYPES один тип ('esf') — классификация сейчас всегда
// тривиальна, но модуль написан так, чтобы добавление 2-го/3-го типа (§4
// Priority 1) не потребовало переписывать вызывающий код в api/accounting/recognize.js.

const { allDocTypeKeys, hintsForClassification } = require('./docSchema');

function buildClassificationInstruction() {
  const hints = hintsForClassification();
  const types = allDocTypeKeys();
  if (types.length === 1) {
    // Единственный поддерживаемый тип — просим модель подтвердить, а не
    // выбрать из списка, и явно предупреждаем, что документ может им не быть.
    //
    // БАГ (Ethan, 14 сен 2026, живой тест на реальном ЭСФ): здесь не было
    // сказано, какое именно значение ставить doc_type при СОВПАДЕНИИ — только
    // что ставить при несовпадении ("unknown"). Gemini на реальном документе
    // разумно, но непредсказуемо придумала "vat_invoice" вместо "esf",
    // pipeline.js жёстко ждёт 'esf' и вернул 422 "тип не распознан" на
    // валидном ЭСФ. Теперь оба случая указаны явно.
    return `Confirm whether this document is: ${hints[types[0]]}. ` +
      `If it matches, set doc_type to "${types[0]}". If the document clearly does not match this description, set doc_type to "unknown".`;
  }
  const lines = types.map(key => `- "${key}": ${hints[key]}`).join('\n');
  return `Classify this accounting document into exactly one of the following categories:\n${lines}\n` +
    'If none clearly match, set doc_type to "unknown".';
}

function classificationSchemaField() {
  return { doc_type: { type: 'STRING' } };
}

module.exports = { buildClassificationInstruction, classificationSchemaField };
