// Классификация документа — независимый модуль.
// Отвечает только за одно: определить тип документа из списка DOC_TYPES.
// Ничего не знает про извлечение полей и про сам текст документа —
// это разделение позволяет использовать классификацию отдельно
// (например, в будущем как самостоятельный /api/v1/classify) или
// пропускать её целиком, если тип уже известен заранее (см. extraction.js).

const { DOC_TYPES, DOC_TYPE_HINTS } = require('./docSchema');

// customDocTypes (опционально) — доп. типы конкретного клиента из Supabase
// (tamga_api_key_fields.custom_doc_types, см. customFieldsLookup.js), вида
// { "Название типа": { fields: [...], hint: "..." } }. Добавляются к общему
// списку категорий наравне со стандартными 21 — модель классифицирует один раз
// сразу по объединённому списку, отдельного прохода не требуется. Без hint
// в промпте используется только название типа.
function allTypesFor(customDocTypes) {
  if (!customDocTypes) return DOC_TYPES;
  return [...DOC_TYPES, ...Object.keys(customDocTypes)];
}

function hintFor(type, customDocTypes) {
  if (DOC_TYPE_HINTS[type]) return DOC_TYPE_HINTS[type];
  if (customDocTypes && customDocTypes[type] && customDocTypes[type].hint) return customDocTypes[type].hint;
  return type;
}

// Текстовая инструкция для модели — вставляется в общий промпт распознавания.
// Каждой категории даём короткую подсказку (DOC_TYPE_HINTS в docSchema.js):
// без них модель чаще путает похожие типы (например, накладную со справочником
// номенклатуры — оба выглядят как таблица товаров, но один из них транзакция
// с суммами, а другой — просто список/каталог без сумм и сторон).
function buildClassificationInstruction(customDocTypes) {
  const types = allTypesFor(customDocTypes);
  const categoryList = types.map(t => `"${t}" (${hintFor(t, customDocTypes)})`).join('; ');
  return `Classify the document into exactly one of these categories, using the hint in parentheses to disambiguate similar-looking documents: ${categoryList}. Base your decision primarily on the document's actual title/header text and structure, not just general similarity. Only choose "Другое" if the document truly does not match any specific category — if it's a plausible but imperfect match for a specific category, prefer that specific category over "Другое". Return only the exact category name (without the hint).`;
}

// Фрагмент JSON-схемы ответа, описывающий поле классификации.
function classificationSchemaField(customDocTypes) {
  return { documentType: { type: 'STRING', enum: allTypesFor(customDocTypes) } };
}

function isValidDocType(value, customDocTypes) {
  return DOC_TYPES.includes(value) || !!(customDocTypes && Object.prototype.hasOwnProperty.call(customDocTypes, value));
}

module.exports = { buildClassificationInstruction, classificationSchemaField, isValidDocType };
