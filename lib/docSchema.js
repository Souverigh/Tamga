// Схема типов документов и полей извлечения.
// ВАЖНО: если добавляете новый тип документа — обновите такую же копию
// констант DOC_TYPES / DOC_FIELDS в public/js/config/docSchema.js (офлайн-режим
// Tesseract использует свою ES-модульную копию на клиенте для эвристической
// классификации/полей, т.к. работает без сервера).

const DOC_TYPES = [
  'Паспорт / удостоверение личности',
  'Водительское удостоверение',
  'Военный билет',
  'Свидетельство о рождении',
  'Свидетельство о браке',
  'Свидетельство о расторжении брака',
  'Свидетельство о смерти',
  'Диплом / аттестат',
  'Справка',
  'Договор',
  'Доверенность',
  'Банковский документ',
  'Платёжное поручение',
  'Квитанция / чек',
  'Накладная / УПД',
  'Счёт-фактура / Инвойс',
  'Акт выполненных работ',
  'Справочник номенклатуры',
  'Техпаспорт автомобиля',
  'Документы на недвижимость',
  'Другое'
];

// Короткая подсказка модели для классификации — что отличает этот тип от
// похожих (в первую очередь: живая транзакция vs справочник/каталог без сумм).
// Используется только в classification.js, на извлечение полей не влияет.
const DOC_TYPE_HINTS = {
  'Паспорт / удостоверение личности': 'official general-purpose ID document with photo and personal data, titled "Паспорт" or "Удостоверение личности" — NOT a driver\'s license or military ID',
  'Водительское удостоверение': 'a driver\'s license titled "Водительское удостоверение", showing vehicle categories (A, B, C...) the holder is licensed to drive',
  'Военный билет': 'a military service ID booklet titled "Военный билет", distinct from a general passport/ID',
  'Свидетельство о рождении': 'birth certificate titled "Свидетельство о рождении"',
  'Свидетельство о браке': 'a certificate titled "Свидетельство о браке" that a marriage was CONCLUDED/registered — NOT a dissolution/divorce document',
  'Свидетельство о расторжении брака': 'a certificate titled "Свидетельство о расторжении брака" that a marriage was DISSOLVED/terminated (divorce) — NOT "Свидетельство о браке"',
  'Свидетельство о смерти': 'a death certificate titled "Свидетельство о смерти"',
  'Диплом / аттестат': 'education diploma, degree or school certificate, titled "Диплом" or "Аттестат"',
  'Справка': 'an official reference/confirmation letter titled "Справка" (e.g. employment, income, residency)',
  'Договор': 'a bilateral or multilateral contract titled "Договор", between two or more named parties, both with obligations',
  'Доверенность': 'a document titled "Доверенность" — a unilateral power of attorney where one person authorizes another to act on their behalf, NOT a two-party "Договор"',
  'Банковский документ': 'a bank statement or account extract, titled e.g. "Выписка по счёту" — NOT a standalone payment order form',
  'Платёжное поручение': 'a standardized bank payment order form, typically titled "Платёжное поручение" (often form 0401060), with payer, payee, sum and payment purpose fields',
  'Квитанция / чек': 'a payment receipt or till/cash receipt for a single purchase, titled "Квитанция" or "Чек"',
  'Накладная / УПД': 'a goods delivery note titled "Накладная", "Товарная накладная" or "УПД", for a SPECIFIC transaction: has a buyer/seller and a table of line items (goods) with prices, quantities and totals',
  'Счёт-фактура / Инвойс': 'a payment invoice titled "Счёт", "Счёт-фактура" or "Invoice", issued for payment/VAT purposes, typically BEFORE goods are delivered — distinct from Накладная/УПД which confirms actual delivery',
  'Акт выполненных работ': 'a document titled "Акт выполненных работ" or "Акт сдачи-приёмки" — a certificate of completed WORK OR SERVICES rendered, with a table of line items for labor/services, not physical goods',
  'Справочник номенклатуры': 'a reference/catalog list of items or products (e.g. a screenshot of an accounting system item directory or price list) — NOT a transaction: no buyer/seller, no totals, just a list of goods with codes/names/units',
  'Техпаспорт автомобиля': 'a vehicle document titled "Технический паспорт транспортного средства" or "Свидетельство о регистрации транспортного средства" (СРТС), with VIN, plate number and owner',
  'Документы на недвижимость': 'a real estate document titled e.g. "Свидетельство о праве собственности" or "Выписка из реестра прав на недвижимое имущество", showing a property owner, address and cadastral number',
  'Другое': 'anything that clearly does not match any category above — use this ONLY as a last resort, see instruction below'
};

const DOC_FIELDS = {
  'Паспорт / удостоверение личности': ['ФИО', 'Дата рождения', 'Пол', 'Гражданство', 'Серия и номер', 'ПИН (ИНН)', 'Дата выдачи', 'Дата окончания', 'Орган выдачи'],
  'Водительское удостоверение': ['ФИО', 'Дата рождения', 'Категории', 'Серия и номер', 'Дата выдачи', 'Дата окончания', 'Орган выдачи'],
  'Военный билет': ['ФИО', 'Дата рождения', 'Серия и номер', 'Воинское звание', 'Военный комиссариат', 'Дата выдачи'],
  'Свидетельство о рождении': ['ФИО ребёнка', 'Дата рождения', 'Место рождения', 'ФИО матери', 'ФИО отца', 'Серия и номер', 'Дата выдачи', 'Орган ЗАГС'],
  'Свидетельство о браке': ['ФИО супруга', 'ФИО супруги', 'Дата заключения брака', 'Серия и номер', 'Орган ЗАГС'],
  'Свидетельство о расторжении брака': ['ФИО супруга', 'ФИО супруги', 'Дата расторжения брака', 'Серия и номер', 'Орган (ЗАГС/суд)', 'Дата выдачи'],
  'Свидетельство о смерти': ['ФИО умершего', 'Дата смерти', 'Место смерти', 'Серия и номер', 'Дата выдачи', 'Орган ЗАГС'],
  'Диплом / аттестат': ['ФИО', 'Учебное заведение', 'Специальность / квалификация', 'Дата выдачи', 'Регистрационный номер'],
  'Справка': ['Кому выдана', 'Тип справки', 'Номер', 'Дата выдачи', 'Организация', 'Срок действия'],
  'Договор': ['Стороны', 'Предмет договора', 'Дата заключения', 'Номер договора', 'Сумма'],
  'Доверенность': ['Доверитель', 'Доверенное лицо', 'Полномочия', 'Дата выдачи', 'Срок действия', 'Номер (нотариальный)'],
  'Банковский документ': ['Владелец счёта', 'Номер счёта / IBAN', 'Банк', 'Сумма', 'Дата операции'],
  'Платёжное поручение': ['Плательщик', 'Получатель', 'Счёт получателя', 'Сумма', 'Дата', 'Номер поручения', 'Назначение платежа'],
  'Квитанция / чек': ['Продавец', 'Дата', 'Сумма итого', 'Номер чека'],
  'Накладная / УПД': {
    mode: 'table',
    columns: ['Наименование', 'Артикул', 'Цена', 'Количество', 'Сумма'],
    keys: ['name', 'id', 'price', 'qty', 'sum'],
    description: 'an invoice/goods delivery note with a table of line items'
  },
  'Счёт-фактура / Инвойс': {
    mode: 'table',
    columns: ['Наименование', 'Артикул', 'Цена', 'Количество', 'Сумма'],
    keys: ['name', 'id', 'price', 'qty', 'sum'],
    description: 'an invoice issued for payment, with a table of line items, structurally similar to a goods delivery note but issued before/for payment rather than confirming delivery'
  },
  'Акт выполненных работ': {
    mode: 'table',
    columns: ['Наименование работ/услуг', 'Ед. изм.', 'Количество', 'Цена', 'Сумма'],
    keys: ['name', 'unit', 'qty', 'price', 'sum'],
    description: 'a certificate of completed work or services, with a table of line items for labor/services rendered rather than physical goods'
  },
  'Справочник номенклатуры': {
    mode: 'table',
    columns: ['Код', 'Артикул', 'Наименование', 'Полное наименование', 'Вид номенклатуры', 'Базовая ед.'],
    keys: ['code', 'article', 'name', 'fullName', 'kind', 'unit'],
    description: 'a nomenclature/catalog reference list (e.g. accounting system item directory), not a transaction — no prices or quantities expected'
  },
  'Техпаспорт автомобиля': ['Владелец', 'Марка / модель', 'Госномер', 'VIN', 'Год выпуска', 'Серия и номер', 'Дата выдачи'],
  'Документы на недвижимость': ['Собственник', 'Адрес объекта', 'Кадастровый номер', 'Площадь', 'Серия и номер', 'Дата выдачи', 'Орган выдачи'],
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
