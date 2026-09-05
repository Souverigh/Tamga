// Схема типов документов и полей извлечения.
// ВАЖНО: если добавляете новый тип документа — обновите такую же копию
// констант DOC_TYPES / DOC_FIELDS в public/js/config/docSchema.js (офлайн-режим
// Tesseract использует свою ES-модульную копию на клиенте для эвристической
// классификации/полей, т.к. работает без сервера).

const DOC_TYPES = [
  'Паспорт / удостоверение личности',
  'Свидетельство о рождении',
  'Свидетельство о браке',
  'Диплом / аттестат',
  'Справка',
  'Договор',
  'Банковский документ',
  'Квитанция / чек',
  'Накладная / УПД',
  'Справочник номенклатуры',
  'Другое'
];

// Короткая подсказка модели для классификации — что отличает этот тип от
// похожих (в первую очередь: живая транзакция vs справочник/каталог без сумм).
// Используется только в classification.js, на извлечение полей не влияет.
const DOC_TYPE_HINTS = {
  'Паспорт / удостоверение личности': 'official ID document with photo and personal data',
  'Свидетельство о рождении': 'birth certificate',
  'Свидетельство о браке': 'marriage certificate',
  'Диплом / аттестат': 'education diploma, degree or school certificate',
  'Справка': 'an official reference/confirmation letter (e.g. employment, income, residency)',
  'Договор': 'a contract or agreement between two or more named parties',
  'Банковский документ': 'a bank statement, account or transfer document',
  'Квитанция / чек': 'a payment receipt or till/cash receipt for a single purchase',
  'Накладная / УПД': 'an invoice or goods delivery note for a SPECIFIC transaction: has a buyer/seller and a table of line items with prices, quantities and totals',
  'Справочник номенклатуры': 'a reference/catalog list of items or products (e.g. a screenshot of an accounting system item directory or price list) — NOT a transaction: no buyer/seller, no totals, just a list of goods with codes/names/units',
  'Другое': 'anything that clearly does not match any category above'
};

const DOC_FIELDS = {
  'Паспорт / удостоверение личности': ['ФИО', 'Дата рождения', 'Пол', 'Гражданство', 'Серия и номер', 'ПИН (ИНН)', 'Дата выдачи', 'Дата окончания', 'Орган выдачи'],
  'Свидетельство о рождении': ['ФИО ребёнка', 'Дата рождения', 'Место рождения', 'ФИО матери', 'ФИО отца', 'Серия и номер', 'Дата выдачи', 'Орган ЗАГС'],
  'Свидетельство о браке': ['ФИО супруга', 'ФИО супруги', 'Дата заключения брака', 'Серия и номер', 'Орган ЗАГС'],
  'Диплом / аттестат': ['ФИО', 'Учебное заведение', 'Специальность / квалификация', 'Дата выдачи', 'Регистрационный номер'],
  'Справка': ['Кому выдана', 'Тип справки', 'Номер', 'Дата выдачи', 'Организация', 'Срок действия'],
  'Договор': ['Стороны', 'Предмет договора', 'Дата заключения', 'Номер договора', 'Сумма'],
  'Банковский документ': ['Владелец счёта', 'Номер счёта / IBAN', 'Банк', 'Сумма', 'Дата операции'],
  'Квитанция / чек': ['Продавец', 'Дата', 'Сумма итого', 'Номер чека'],
  'Накладная / УПД': {
    mode: 'table',
    columns: ['Наименование', 'Артикул', 'Цена', 'Количество', 'Сумма'],
    keys: ['name', 'id', 'price', 'qty', 'sum'],
    description: 'an invoice/goods delivery note with a table of line items'
  },
  'Справочник номенклатуры': {
    mode: 'table',
    columns: ['Код', 'Артикул', 'Наименование', 'Полное наименование', 'Вид номенклатуры', 'Базовая ед.'],
    keys: ['code', 'article', 'name', 'fullName', 'kind', 'unit'],
    description: 'a nomenclature/catalog reference list (e.g. accounting system item directory), not a transaction — no prices or quantities expected'
  },
  'Другое': ['Краткое содержание', 'Дата', 'Номер']
};

// Тип документа с табличной структурой (несколько строк, а не карточка
// {label, value}). Каждый табличный тип несёт СВОИ columns/keys/description —
// это позволяет добавлять новые табличные типы (как «Справочник номенклатуры»)
// без изменений в остальном коде.
function isTableType(docType) {
  const entry = DOC_FIELDS[docType];
  return !!entry && !Array.isArray(entry) && entry.mode === 'table';
}

function columnsForType(docType) {
  const entry = DOC_FIELDS[docType];
  return isTableType(docType) ? entry.columns : null;
}

function keysForType(docType) {
  const entry = DOC_FIELDS[docType];
  return isTableType(docType) ? entry.keys : null;
}

function descriptionForType(docType) {
  const entry = DOC_FIELDS[docType];
  return isTableType(docType) ? entry.description : null;
}

module.exports = {
  DOC_TYPES,
  DOC_FIELDS,
  DOC_TYPE_HINTS,
  isTableType,
  columnsForType,
  keysForType,
  descriptionForType
};
