// Draft label mappings, not replicas of government forms or certified translations.
// Each selection is validated into a fresh copy before editing.
function draft(id, name, docType, rows, matchText = []) {
  return { id, template: { version: 1, name: `Черновик — ${name} — EN v1`, docType,
    language: 'en', matchText, fields: rows.map(([source, target, preserve = false, required = false]) =>
      ({ source, target, preserve, required })) } };
}

export const STARTER_TEMPLATES = [
  draft('passport-en-v1', 'Паспорт / удостоверение личности', 'Паспорт / удостоверение личности', [
    ['ФИО', 'Full name', true, true],
    ['Дата рождения', 'Date of birth', true],
    ['Пол', 'Sex'],
    ['Гражданство', 'Citizenship'],
    ['Серия и номер', 'Document series and number', true, true],
    ['ПИН (ИНН)', 'Personal identification number (taxpayer identification number)', true],
    ['Дата выдачи', 'Date of issue', true],
    ['Дата окончания', 'Date of expiry', true],
    ['Орган выдачи', 'Issuing authority']
  ]),
  draft('birth-en-v1', 'Свидетельство о рождении', 'Свидетельство о рождении', [
    ['ФИО ребёнка', "Child’s full name", true, true],
    ['Дата рождения', 'Date of birth', true, true],
    ['Место рождения', 'Place of birth'],
    ['ФИО матери', "Mother’s full name", true],
    ['ФИО отца', "Father’s full name", true],
    ['Серия и номер', 'Certificate series and number', true],
    ['Дата выдачи', 'Date of issue', true],
    ['Орган ЗАГС', 'Civil registration authority']
  ]),
  draft('marriage-en-v1', 'Свидетельство о браке', 'Свидетельство о браке', [
    ['ФИО супруга', "Husband’s full name", true, true],
    ['ФИО супруги', "Wife’s full name", true, true],
    ['Дата заключения брака', 'Date of marriage', true],
    ['Серия и номер', 'Certificate series and number', true],
    ['Орган ЗАГС', 'Civil registration authority']
  ]),
  draft('education-en-v1', 'Диплом / аттестат', 'Диплом / аттестат', [
    ['ФИО', 'Full name', true, true],
    ['Учебное заведение', 'Educational institution', false, true],
    ['Специальность / квалификация', 'Specialisation / qualification'],
    ['Дата выдачи', 'Date of issue', true],
    ['Регистрационный номер', 'Registration number', true]
  ]),
  draft('employment-en-v1', 'Справка с места работы', 'Справка', [
    ['Кому выдана', 'Issued to', true, true],
    ['Тип справки', 'Type of certificate'],
    ['Номер', 'Certificate number', true],
    ['Дата выдачи', 'Date of issue', true],
    ['Организация', 'Organisation', false, true],
    ['Срок действия', 'Validity period']
  ], ['работ'])
];
