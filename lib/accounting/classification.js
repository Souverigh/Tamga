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
    return `Confirm whether this document is: ${hints[types[0]]}. ` +
      'If the document clearly does not match this description, set doc_type to "unknown".';
  }
  const lines = types.map(key => `- "${key}": ${hints[key]}`).join('\n');
  return `Classify this accounting document into exactly one of the following categories:\n${lines}\n` +
    'If none clearly match, set doc_type to "unknown".';
}

function classificationSchemaField() {
  return { doc_type: { type: 'STRING' } };
}

module.exports = { buildClassificationInstruction, classificationSchemaField };
