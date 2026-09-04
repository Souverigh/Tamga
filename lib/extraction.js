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

const { DOC_TYPES, DOC_FIELDS, LINE_ITEM_KEYS, isTableType, columnsForType } = require('./docSchema');

// Карта полей только для «плоских» (label/value) типов — используется как
// запасной вариант и для промпта, когда тип неизвестен заранее (см. ниже:
// в этом случае табличные типы вроде накладной из карты исключаются, т.к.
// их нельзя корректно описать как label/value — см. buildExtractionInstruction).
function flatFieldsMap() {
  return Object.fromEntries(Object.entries(DOC_FIELDS).filter(([, v]) => Array.isArray(v)));
}

function fieldsForType(docType) {
  const entry = DOC_FIELDS[docType];
  if (Array.isArray(entry)) return entry;
  return DOC_FIELDS['Другое'];
}

// Инструкция для модели.
//   - Тип известен заранее и это табличный тип (накладная/УПД) — просим
//     массив товарных строк (items), а не label/value.
//   - Тип известен заранее и обычный — даём только его набор полей (короче и точнее промпт).
//   - Тип неизвестен — даём полную карту полей по «плоским» типам, модель сама
//     подставит нужный набор под тип, который определит. Табличные типы в эту
//     карту не входят: без знания типа заранее классификация+извлечение идёт
//     одним вызовом, и авто-классификация в накладную сейчас не поддерживается —
//     пользователь должен выбрать этот тип вручную в интерфейсе (см. app.js).
function buildExtractionInstruction(knownDocType) {
  if (knownDocType && isTableType(knownDocType)) {
    const columns = columnsForType(knownDocType);
    return `The document type is already known: "${knownDocType}" — an invoice/goods delivery note with a table of line items. Extract EVERY line item row as an object with keys ${JSON.stringify(LINE_ITEM_KEYS)} corresponding to these Russian columns in order: ${JSON.stringify(columns)}. Leave a key as an empty string if that cell is missing for a row. Return one object per row, in the same order as in the document.`;
  }
  if (knownDocType && DOC_TYPES.includes(knownDocType)) {
    const fields = fieldsForType(knownDocType);
    return `The document type is already known: "${knownDocType}". Extract structured fields as label/value pairs using EXACTLY these Russian field labels (leave value as an empty string if not present in the document): ${JSON.stringify(fields)}.`;
  }
  return `Based on the detected category, extract structured fields as label/value pairs. Use EXACTLY the Russian field labels for that category from this mapping (leave value as an empty string if not present in the document): ${JSON.stringify(flatFieldsMap())}.`;
}

// Фрагмент JSON-схемы ответа, описывающий массив полей label/value.
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

// Фрагмент JSON-схемы ответа, описывающий массив товарных строк (табличные типы).
function itemsSchemaField() {
  const properties = Object.fromEntries(LINE_ITEM_KEYS.map(k => [k, { type: 'STRING' }]));
  return {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties,
        required: LINE_ITEM_KEYS
      }
    }
  };
}

module.exports = { buildExtractionInstruction, extractionSchemaField, itemsSchemaField, fieldsForType };
