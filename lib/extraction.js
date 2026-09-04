// Извлечение структурированных полей — независимый модуль.
// Не знает, как определяется тип документа (это дело classification.js) —
// только берёт готовый тип (или список всех типов, если тип неизвестен)
// и строит инструкцию + схему для извлечения полей под него.
//
// Работает в двух режимах:
//   - docType известен заранее (пользователь выбрал вручную в интерфейсе) —
//     классификация вообще не нужна, извлекаем поля сразу под этот тип;
//   - docType неизвестен — извлекаем поля под тип, который определит
//     классификация в этом же запросе (см. recognize.js, где оба модуля
//     объединяются в один вызов Gemini ради экономии).

const { DOC_TYPES, DOC_FIELDS } = require('./docSchema');

function fieldsForType(docType) {
  return DOC_FIELDS[docType] || DOC_FIELDS['Другое'];
}

// Инструкция для модели. Если тип уже известен — даём только его набор полей
// (короче и точнее промпт). Если нет — даём полную карту полей по всем типам,
// модель сама подставит нужный набор под тип, который определит.
function buildExtractionInstruction(knownDocType) {
  if (knownDocType && DOC_TYPES.includes(knownDocType)) {
    const fields = fieldsForType(knownDocType);
    return `The document type is already known: "${knownDocType}". Extract structured fields as label/value pairs using EXACTLY these Russian field labels (leave value as an empty string if not present in the document): ${JSON.stringify(fields)}.`;
  }
  return `Based on the detected category, extract structured fields as label/value pairs. Use EXACTLY the Russian field labels for that category from this mapping (leave value as an empty string if not present in the document): ${JSON.stringify(DOC_FIELDS)}.`;
}

// Фрагмент JSON-схемы ответа, описывающий массив полей.
function extractionSchemaField() {
  return {
    fields: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          value: { type: 'STRING' }
        },
        required: ['label', 'value']
      }
    }
  };
}

module.exports = { buildExtractionInstruction, extractionSchemaField, fieldsForType };
