// Классификация документа — независимый модуль.
// Отвечает только за одно: определить тип документа из списка DOC_TYPES.
// Ничего не знает про извлечение полей и про сам текст документа —
// это разделение позволяет использовать классификацию отдельно
// (например, в будущем как самостоятельный /api/v1/classify) или
// пропускать её целиком, если тип уже известен заранее (см. extraction.js).

const { DOC_TYPES } = require('./docSchema');

// Текстовая инструкция для модели — вставляется в общий промпт распознавания.
function buildClassificationInstruction() {
  return `Classify the document into exactly one of these categories: ${DOC_TYPES.join(', ')}.`;
}

// Фрагмент JSON-схемы ответа, описывающий поле классификации.
function classificationSchemaField() {
  return { documentType: { type: 'STRING', enum: DOC_TYPES } };
}

function isValidDocType(value) {
  return DOC_TYPES.includes(value);
}

module.exports = { buildClassificationInstruction, classificationSchemaField, isValidDocType };
