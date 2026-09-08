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
// сразу по объединённому списку, отдельного прохода не требуется.
function allTypesFor(customDocTypes) {
  if (!customDocTypes) return DOC_TYPES;
  return [...DOC_TYPES, ...Object.keys(customDocTypes)];
}

// Ethan, 7 сен 2026: клиенты сами создают кастомные типы через /admin и часто
// либо не заполняют подсказку вообще, либо пишут в неё то же самое название
// типа ("Медицинская страховка" -> подсказка "Медицинская страховка") — ноль
// дополнительного сигнала для классификации. Просить их писать содержательные
// подсказки самостоятельно нереалистично для самообслуживания (человек хочет
// просто вбить название типа и список полей, не заниматься промпт-инжинирингом).
//
// Решение: список полей ЭТОГО ЖЕ типа (который человек и так обязан заполнить
// при создании типа, для извлечения) — бесплатный дополнительный сигнал для
// классификации, автоматически, без единого лишнего действия от пользователя.
// "Медицинская страховка" сама по себе неотличима от прочих типов, но
// "Медицинская страховка; fields: ФИО, Номер группы, Номер подписки" — уже
// достаточно конкретно, даже если сам документ на другом языке (см. реальный
// случай: карта Blue Care Network, полностью на английском, классификация без
// этого сигнала выбрала "Другое", хотя извлечение полей — по общей карте полей
// извлечения, а не по этой инструкции — сработало верно).
// Не гарантирует 100% попадание (короткое название типа в принципе не может
// дать классификатору — что человеку, что модели — исчерпывающий сигнал), но
// улучшает его бесплатно, без требования к пользователю писать промпты вручную.
function hintFor(type, customDocTypes) {
  if (DOC_TYPE_HINTS[type]) return DOC_TYPE_HINTS[type];
  if (customDocTypes && customDocTypes[type]) {
    const entry = customDocTypes[type];
    const parts = [];
    if (entry.hint) parts.push(entry.hint);
    if (Array.isArray(entry.fields) && entry.fields.length) parts.push(`fields: ${entry.fields.join(', ')}`);
    return parts.length ? parts.join('; ') : type;
  }
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
