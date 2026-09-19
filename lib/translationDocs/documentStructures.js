// Реестр структур документов для распознавания и перевода.
//
// Новый тип документа добавляется здесь: поля, подсказка классификации и
// дополнительные признаки структуры не должны быть разбросаны по пайплайну.
// Значения документа Gemini возвращает по этим полям, а не по произвольной
// заглушке.

const { APOSTILLE_FIELDS } = require('./apostille');
const { DOC_TYPES } = require('../docSchema');

// Канонические определения полей. В схемах документов используются ID, а не
// повторяющиеся подписи. Поэтому "ФИО", "Дата выдачи", "Адрес" и т.п. имеют
// один источник определения во всём каталоге.
const FIELD_DEFINITIONS = {
  fullName: { label: 'ФИО', kind: 'name' },
  birthDate: { label: 'Дата рождения', kind: 'date' },
  birthPlace: { label: 'Место рождения' },
  country: { label: 'Страна выдачи' },
  gender: { label: 'Пол' },
  citizenship: { label: 'Гражданство' },
  ethnicity: { label: 'Национальность' },
  maritalStatus: { label: 'Семейное положение' },
  surname: { label: 'Фамилия', kind: 'name' },
  givenName: { label: 'Имя', kind: 'name' },
  patronymic: { label: 'Отчество', kind: 'name' },
  mrz: { label: 'MRZ' },
  documentNumber: { label: 'Серия и номер' },
  taxId: { label: 'ПИН (ИНН)' },
  issueDate: { label: 'Дата выдачи', kind: 'date' },
  expiryDate: { label: 'Дата окончания', kind: 'date' },
  issuingAuthority: { label: 'Орган выдачи' },
  institution: { label: 'Учебное заведение' },
  locality: { label: 'Населённый пункт' },
  graduationYear: { label: 'Год окончания', kind: 'date' },
  registrationNumber: { label: 'Регистрационный номер' },
  educationLanguage: { label: 'Язык обучения' },
  director: { label: 'Директор' },
  deputyDirector: { label: 'Заместитель директора' },
  classTeacher: { label: 'Классный руководитель' },
  seal: { label: 'Печать' },
  verificationUrl: { label: 'QR-код/ссылка проверки' },
  subjectsAndGrades: { label: 'Предметы и оценки' },
  finalExamsAndGrades: { label: 'Итоговые экзамены и оценки' },
  documentType: { label: 'Вид документа' },
  documentTitle: { label: 'Название документа' },
  address: { label: 'Адрес' },
  date: { label: 'Дата' },
  organization: { label: 'Организация' },
  amount: { label: 'Сумма' }
  ,militaryRank: { label: 'Воинское звание' }
  ,militaryUnit: { label: 'Воинская часть' }
  ,spouseName: { label: 'ФИО супруга' }
  ,spouseFemaleName: { label: 'ФИО супруги' }
  ,  marriageDate: { label: 'Дата заключения брака', kind: 'date' }
  ,marriagePlace: { label: 'Место заключения брака' }
  ,previousSurname: { label: 'Фамилия после брака' }
  ,recordNumber: { label: 'Номер записи' }
  ,deathDate: { label: 'Дата смерти' }
  ,deathPlace: { label: 'Место смерти' }
  ,deathCause: { label: 'Причина смерти' }
  ,qualification: { label: 'Квалификация' }
  ,specialty: { label: 'Специальность' }
  ,jobOrStudyPlace: { label: 'Место работы/учёбы' }
  ,position: { label: 'Должность' }
  ,period: { label: 'Период' }
  ,partyOne: { label: 'Сторона 1' }
  ,partyTwo: { label: 'Сторона 2' }
  ,subject: { label: 'Предмет договора' }
  ,validityPeriod: { label: 'Срок действия' }
  ,powers: { label: 'Полномочия' }
  ,bank: { label: 'Банк' }
  ,accountNumber: { label: 'Номер счёта' }
  ,accountOwner: { label: 'Владелец счёта' }
  ,transactionDate: { label: 'Дата операции' }
  ,operations: { label: 'Операции' }
  ,balance: { label: 'Итоговый остаток' }
  ,currency: { label: 'Валюта' }
  ,payer: { label: 'Плательщик' }
  ,recipient: { label: 'Получатель' }
  ,paymentPurpose: { label: 'Назначение платежа' }
  ,seller: { label: 'Продавец' }
  ,buyer: { label: 'Покупатель' }
  ,itemName: { label: 'Наименование товаров' }
  ,quantity: { label: 'Количество' }
  ,vat: { label: 'НДС' }
  ,total: { label: 'Итого' }
  ,executor: { label: 'Исполнитель' }
  ,customer: { label: 'Заказчик' }
  ,workDescription: { label: 'Описание работ' }
  ,code: { label: 'Код' }
  ,unit: { label: 'Единица измерения' }
  ,price: { label: 'Цена' }
  ,vehicleModel: { label: 'Марка и модель' }
  ,licensePlate: { label: 'Государственный номер' }
  ,vin: { label: 'VIN' }
  ,productionYear: { label: 'Год выпуска' }
  ,owner: { label: 'Владелец' }
  ,cadastralNumber: { label: 'Кадастровый номер' }
  ,area: { label: 'Площадь' }
  ,rightType: { label: 'Вид права' }
};

const STANDARD_TRANSLATION_FIELDS = {
  'Паспорт / удостоверение личности': ['country', 'documentType', 'surname', 'givenName', 'patronymic', 'birthDate', 'birthPlace', 'gender', 'citizenship', 'ethnicity', 'maritalStatus', 'documentNumber', 'taxId', 'address', 'issueDate', 'expiryDate', 'issuingAuthority', 'mrz'],
  'Водительское удостоверение': ['fullName', 'birthDate', 'documentNumber', 'issueDate', 'expiryDate', 'issuingAuthority'],
  'Военный билет': ['fullName', 'birthDate', 'documentNumber', 'issueDate'],
  'Свидетельство о рождении': ['fullName', 'birthDate', 'locality', 'issueDate'],
  'Свидетельство о браке': ['spouseName', 'spouseFemaleName', 'marriageDate', 'marriagePlace', 'previousSurname', 'recordNumber', 'issueDate'],
  'Свидетельство о расторжении брака': ['fullName', 'marriageDate', 'recordNumber', 'issueDate', 'issuingAuthority'],
  'Свидетельство о смерти': ['fullName', 'birthDate', 'issueDate'],
  'Аттестат': ['country', 'documentType', 'fullName', 'birthDate', 'birthPlace', 'institution', 'locality', 'graduationYear', 'documentNumber', 'issueDate', 'registrationNumber', 'educationLanguage', 'director', 'deputyDirector', 'classTeacher', 'seal', 'verificationUrl', 'subjectsAndGrades', 'finalExamsAndGrades'],
  'Диплом / аттестат': ['fullName', 'institution', 'documentNumber', 'issueDate'],
  'Справка': ['documentType', 'fullName', 'birthDate', 'issueDate', 'issuingAuthority'],
  'Договор': ['documentType', 'documentNumber', 'date', 'partyOne', 'partyTwo', 'subject', 'amount', 'validityPeriod'],
  'Доверенность': ['fullName', 'documentNumber', 'powers', 'issueDate', 'expiryDate', 'issuingAuthority'],
  'Банковский документ': ['bank', 'accountNumber', 'accountOwner', 'period', 'transactionDate', 'operations', 'balance', 'currency'],
  'Платёжное поручение': ['documentNumber', 'date', 'payer', 'taxId', 'recipient', 'amount', 'paymentPurpose'],
  'Квитанция / чек': ['documentNumber', 'date', 'seller', 'buyer', 'itemName', 'amount', 'currency'],
  'Накладная / УПД': ['documentNumber', 'date', 'seller', 'buyer', 'itemName', 'quantity', 'amount', 'vat', 'total'],
  'Счёт-фактура / Инвойс': ['documentNumber', 'date', 'seller', 'buyer', 'itemName', 'quantity', 'amount', 'vat', 'total'],
  'Акт выполненных работ': ['documentNumber', 'date', 'executor', 'customer', 'workDescription', 'quantity', 'amount', 'vat', 'total'],
  'Справочник номенклатуры': ['code', 'itemName', 'unit', 'price', 'vat'],
  'Техпаспорт автомобиля': ['vehicleModel', 'licensePlate', 'vin', 'productionYear', 'owner', 'issueDate'],
  'Документы на недвижимость': ['owner', 'address', 'cadastralNumber', 'area', 'rightType', 'issueDate', 'issuingAuthority'],
  'Другое': ['documentTitle', 'documentNumber', 'date', 'organization', 'amount']
};

function genericFields(fieldIds) {
  return fieldIds.map(key => {
    const definition = FIELD_DEFINITIONS[key] || { label: key };
    return { key, label: definition.label, ...(definition.kind ? { kind: definition.kind } : {}) };
  });
}

const TYPE_REGISTRY = Object.fromEntries([
  ['apostille', {
    label: 'Апостиль',
    fields: APOSTILLE_FIELDS,
    hint: 'an apostille certificate headed Apostille or Апостиль',
    preservesParagraphs: false
  }],
  ...DOC_TYPES.map(label => [label, {
    label,
    fields: genericFields(STANDARD_TRANSLATION_FIELDS[label] || ['Название документа', 'Номер', 'Дата', 'Прочий текст']),
    hint: `a document of type "${label}"`,
    // Аттестат больше не дублируется как параграфы — таблицы (предметы/
    // оценки) и поля (fields) уже полностью описывают документ; сплошной
    // повторный текст снизу перевода был чистым дублированием одних и тех
    // же данных (Ethan, 18 сен 2026, живой кейс).
    preservesParagraphs: label === 'Другое',
    ...(label === 'Аттестат' ? {
      layout: {
        sections: [
          { key: 'identity', title: 'Сведения о выпускнике' },
          { key: 'subjects', title: 'Предметы и оценки', table: ['Предмет', 'Оценка'] },
          { key: 'finalExams', title: 'Итоговые экзамены', table: ['Предмет', 'Оценка'] },
          { key: 'certification', title: 'Подписи, печать и проверка' }
        ]
      }
    } : {})
  }])
]);

function getDocumentStructure(docType, customTypes = {}) {
  const customEntry = customTypes && customTypes[docType];
  if (customEntry) {
    const labels = Array.isArray(customEntry.fields) ? customEntry.fields : [];
    return {
      label: docType,
      fields: genericFields(labels),
      hint: customEntry.hint || `a custom document type "${docType}"`,
      preservesParagraphs: true
    };
  }
  return TYPE_REGISTRY[docType] || null;
}

module.exports = {
  FIELD_DEFINITIONS,
  STANDARD_TRANSLATION_FIELDS,
  TYPE_REGISTRY,
  getDocumentStructure,
  genericFields
};
