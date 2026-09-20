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
  passportType: { label: 'Тип' },
  passportNumber: { label: 'Номер паспорта' },
  // Ethan, 19 сен 2026: после добавления pageSerialNumber ниже прислал ЕЩЁ
  // один реальный пример (паспорт "Jennifer Collee") и сообщил, что текст
  // "Оговорки и ограничения" по-прежнему не появляется в переводе — ни в
  // виде отдельного файла, ни как часть той же картинки, что и биометрическая
  // страница. Раньше это поле уходило в Gemini ГОЛЫМ лейблом среди дюжины
  // других (buildCombinedInstruction берёт только label, без hint) — для
  // короткого поля вроде "Дата рождения" этого достаточно, а для
  // многострочного текста в отдельной рамке на СОСЕДНЕЙ странице — нет:
  // модель могла просто не связывать подпись с этим визуальным блоком.
  // Добавлен параметр hint (buildCombinedInstruction теперь передаёт его
  // Gemini отдельной строкой на поле, см. fieldHints) — описывает ИМЕННО
  // где и как выглядит блок, а не просто что он значит.
  restrictionsText: {
    label: 'Оговорки и ограничения',
    hint: 'The paragraph of printed notice text inside a bordered/boxed section headed "ENDORSEMENTS AND LIMITATIONS" / "MENTIONS ET RESTRICTIONS" (or an equivalent heading in another language) — this is usually on the page FACING the main biodata page, not on the biodata page itself, and may be on a separate photo/scan from the biodata page. Transcribe the full notice text, including a second paragraph such as "SEE OBSERVATIONS..." if printed. Do not skip this field just because it is not on the same page as the other fields.'
  },
  // Боковой печатный код страницы (пример реального образца — "ELZ 97532"),
  // напечатан вертикально на полях канадского паспорта — Ethan, 19 сен 2026,
  // на реальном скане показал, что это поле сейчас вообще не извлекается и
  // не попадает в перевод, хотя должно. Label специально содержит "номер" —
  // подпадает под уже существующий PRESERVE_LABEL в pipeline.js (значение —
  // буквенно-цифровой код, переводить его как текст было бы ошибкой), без
  // добавления отдельной фразы в регулярное выражение.
  pageSerialNumber: {
    label: 'Серийный номер страницы',
    hint: 'The short alphanumeric code printed sideways/vertically along the edge of a passport page (e.g. "ELZ 97532" or "GK48539") — often near the "Оговорки и ограничения" box on the endorsements page. Distinct from the passport number.'
  },
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
  // seal/signature/qrCode — графические элементы, не текст: транскрибировать
  // штамп/подпись/QR как есть бессмысленно (нечитаемая печать, факсимильная
  // подпись, чёрно-белый узор) — Gemini просто отмечает их наличие
  // плейсхолдером [seal]/[signature]/[qr], а pipeline.js/localizeMarkers
  // (field-rules.mjs) подставляют готовую подпись на языке перевода (тот же
  // приём, что уже был только для апостиля, см. apostille.js — Ethan, 19 сен
  // 2026: "указывать и обрабатывать так же, как мы уже сделали для подписей",
  // распространить на все типы документов). kind читается в pipeline.js
  // ДО проверки NAME_LABEL/PRESERVE_LABEL — иначе "Подпись" попала бы под
  // NAME_LABEL (там есть "Подпис") и ушла бы на транслитерацию как имя.
  seal: {
    label: 'Печать',
    kind: 'seal',
    hint: 'This is ONLY for a graphical stamp/seal that has no legible wording of its own (a round ink/embossed seal, a coat of arms, an illegible blot) — set the value to exactly "[seal]" for that, do not attempt to transcribe or describe it. If genuinely no such stamp/seal is present, leave the value empty. If instead the stamp/box has its own clearly readable printed or handwritten text (e.g. a rectangular stamp reading "ДУБЛИКАТ"/"КАЙТАЛАНГАН"/"КОПИЯ ВЕРНА"/"ПОГАШЕНО" or similar), do NOT put "[seal]" here — transcribe that text into the separate "stampText" field instead, so it gets translated like normal text.'
  },
  // Читаемый текст штампа/отметки — в отличие от seal (только нечитаемый
  // графический элемент), это осмысленный текст ("Дубликат", "Погашено",
  // "Копия верна" и т.п.), который нужно ПЕРЕВЕСТИ как обычное поле, а не
  // заменить плейсхолдером (Ethan, 19 сен 2026, реальный пример — киргизский
  // прямоугольный штамп "КАЙТАЛАНГАН" = "Дубликат/Повторно"). Тот же принцип,
  // что stamp_text у апостиля (apostille.js), только для остальных типов
  // документов, где нет отдельного открытого массива элементов.
  stampText: {
    label: 'Текст на штампе',
    hint: 'A rectangular or other stamp/box on the document that has its own clearly readable printed or handwritten text conveying meaning — e.g. "ДУБЛИКАТ"/"КАЙТАЛАНГАН" (duplicate), "ПОГАШЕНО" (voided/cancelled), "КОПИЯ ВЕРНА" (certified true copy), a registration mark, etc. Transcribe the text exactly as printed. This is distinct from an illegible graphical seal/emblem (see the separate "seal" field) — if there is no such readable stamp, leave this empty.'
  },
  signature: {
    label: 'Подпись',
    kind: 'signature',
    hint: 'If a handwritten/graphical signature is visible anywhere on the document, set the value to exactly "[signature]" — do not attempt to transcribe it. If a printed name accompanies the signature, that belongs in its own separate field, not here. If genuinely no signature is present, leave the value empty.'
  },
  qrCode: {
    label: 'QR-код',
    kind: 'qrCode',
    hint: 'If a QR code graphic is visible anywhere on the document, set the value to exactly "[qr]" — do not attempt to read or guess its encoded content. If genuinely no QR code is present, leave the value empty.'
  },
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
  // Поля "Свидетельства о рождении" (реальный перевод бюро, прислан Ethan
  // 19 сен 2026, "шаблон свидетельство о рождении.docx") — родительский блок
  // (отец/мать) требует отдельных id для ПИН/гражданства/национальности
  // каждого родителя (два человека в одном списке полей, general-purpose
  // citizenship/ethnicity/taxId для этого не годятся — потребовались бы
  // дважды на разные значения одновременно). fullName/taxId переиспользованы
  // для ребёнка (стандартные общие поля); recordNumber уже существовал
  // (Свидетельство о браке).
  ,fatherName: { label: 'ФИО отца', kind: 'name' }
  ,fatherPin: { label: 'ПИН отца' }
  ,fatherCitizenship: { label: 'Гражданство отца' }
  ,fatherNationality: { label: 'Национальность отца' }
  ,motherName: { label: 'ФИО матери', kind: 'name' }
  ,motherPin: { label: 'ПИН матери' }
  ,motherCitizenship: { label: 'Гражданство матери' }
  ,motherNationality: { label: 'Национальность матери' }
  ,recordDate: { label: 'Дата составления записи', kind: 'date' }
  // Содержит "ФИО", чтобы попасть под NAME_LABEL в pipeline.js — это ФИО
  // человека (сотрудника ЗАГС), а не служебный текст, ему нужна
  // транслитерация, а не обычный перевод.
  ,responsibleEmployee: { label: 'ФИО ответственного сотрудника ЗАГС', kind: 'name' }
  // Поля "Справки о несудимости" (реальный перевод бюро, прислан Ethan
  // 19 сен 2026, "шаблон справка о несудимости Тундук.docx") — документ
  // сформирован порталом электронных услуг КР "Тундук", не бумажный бланк
  // ЗАГС, отсюда специфичные поля (идентификационный код, дата/время
  // формирования, код электронной подписи), которых нет у других типов.
  ,certificateStatus: { label: 'Результат (статус)' }
  ,identificationCode: { label: 'Идентификационный код' }
  ,issuanceNote: { label: 'Примечание об актуальности на дату выдачи' }
  ,contactNote: { label: 'Контакты для вопросов' }
  ,formationDateTime: { label: 'Дата и время формирования документа', kind: 'date' }
  ,sourceSystemNote: { label: 'Примечание об источнике данных' }
  ,legalValidityNote: { label: 'Примечание о юридической силе документа' }
  ,actualityNote: { label: 'Примечание об актуальности данных' }
  ,formedByAuthority: { label: 'Документ сформирован' }
  ,signatureDate: { label: 'Дата подписи', kind: 'date' }
  ,signatureCode: { label: 'Код подписи' }
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
  // Отдельный тип (не вариант вёрстки внутри общей ID-карты) — снят с
  // реального перевода бюро ("Паспорт Канада.docx", прислан Ethan 19 сен
  // 2026): собственная страничная вёрстка ICAO-паспорта (Тип/Код/Номер
  // паспорта отдельной строкой, фотоблок, MRZ) и опциональная страница
  // "Оговорки и ограничения" — у обычной ID-карты этого набора полей нет.
  // Заголовок страницы ("КАНАДА" / название страны и слово "ПАСПОРТ")
  // зафиксирован в самой вёрстке, не отдельными полями — тип документа по
  // определению всегда "паспорт Канады", см. passportCanadaDocx.mjs.
  // pageSerialNumber добавлен 19 сен 2026 (см. комментарий у FIELD_DEFINITIONS
  // выше) — Ethan показал на реальном скане, что этот боковой код страницы
  // не извлекался вообще.
  'Паспорт Канады': ['passportType', 'code', 'passportNumber', 'surname', 'givenName', 'citizenship', 'birthDate', 'birthPlace', 'gender', 'issueDate', 'expiryDate', 'issuingAuthority', 'mrz', 'pageSerialNumber', 'restrictionsText'],
  // Два отдельных типа (не варианты вёрстки общей ID-карты) — сняты с
  // реального перевода бюро ("шаблон паспорт узб.doc", прислан Ethan 19 сен
  // 2026: одна страница с ДВУМЯ разными настоящими документами одного
  // человека). Страна фиксирована в самой вёрстке (как у "Паспорт Канады"),
  // отдельного поля country нет — см. passportUzbekistanOldDocx.mjs /
  // passportUzbekistanDocx.mjs.
  'Паспорт Узбекистана (старого образца)': ['surname', 'givenName', 'patronymic', 'gender', 'birthDate', 'birthPlace', 'ethnicity', 'issuingAuthority'],
  'Паспорт Узбекистана (биометрический)': ['passportType', 'code', 'passportNumber', 'surname', 'givenName', 'citizenship', 'birthDate', 'birthPlace', 'gender', 'issueDate', 'expiryDate', 'issuingAuthority', 'mrz'],
  'Водительское удостоверение': ['fullName', 'birthDate', 'documentNumber', 'issueDate', 'expiryDate', 'issuingAuthority'],
  'Военный билет': ['fullName', 'birthDate', 'documentNumber', 'issueDate'],
  // Расширено с общей заглушки до реальной структуры бюро (Ethan, 19 сен
  // 2026, "шаблон свидетельство о рождении.docx", реальный перевод
  // киргизского свидетельства о рождении) — см. birthCertificateDocx.mjs.
  // country — как у Аттестата/ID-карты, не зафиксирован жёстко: тип не
  // привязан к одной стране. documentNumber — код документа/QR (в образце
  // печатается дважды, здесь один раз). seal — печать/штамп ЗАГС (текст,
  // который распознала модель, не жёсткая цитата одного образца).
  'Свидетельство о рождении': ['country', 'documentNumber', 'fullName', 'taxId', 'birthDate', 'birthPlace', 'recordNumber', 'recordDate', 'fatherName', 'fatherPin', 'fatherCitizenship', 'fatherNationality', 'motherName', 'motherPin', 'motherCitizenship', 'motherNationality', 'issuingAuthority', 'issueDate', 'responsibleEmployee', 'seal', 'signature', 'qrCode', 'stampText'],
  'Свидетельство о браке': ['spouseName', 'spouseFemaleName', 'marriageDate', 'marriagePlace', 'previousSurname', 'recordNumber', 'issueDate', 'seal', 'signature', 'stampText'],
  'Свидетельство о расторжении брака': ['fullName', 'marriageDate', 'recordNumber', 'issueDate', 'issuingAuthority', 'seal', 'signature', 'stampText'],
  // Расширено с общей заглушки до реальной структуры бюро (Ethan, 19 сен
  // 2026, "свидетельство о смерти шаблон.docx", реальный перевод
  // киргизского свидетельства о смерти) — см. deathCertificateDocx.mjs.
  // Все поля уже существовали (переиспользованы у Свидетельства о
  // рождении/Аттестата) — новых FIELD_DEFINITIONS не понадобилось.
  // citizenship — образец подписывает поле "Nationality", но значение это
  // страна ("KYRGYZ REPUBLIC"), не этнос — тот же случай, что и у ID-карты
  // (citizenship подписан "Citizenship" даже когда в образце "Nationality"),
  // сопоставление по смыслу значения, не по буквальной подписи бюро.
  'Свидетельство о смерти': ['country', 'documentNumber', 'fullName', 'taxId', 'birthDate', 'birthPlace', 'citizenship', 'deathDate', 'deathPlace', 'recordNumber', 'recordDate', 'issuingAuthority', 'issueDate', 'responsibleEmployee', 'seal', 'signature', 'qrCode', 'stampText'],
  // Отдельный тип (не вариант generic "Справка") — снят с реального перевода
  // бюро ("шаблон справка о несудимости Тундук.docx", прислан Ethan 19 сен
  // 2026): справка сформирована порталом "Тундук", не бумажный бланк ЗАГС —
  // см. noCriminalRecordDocx.mjs. qrCode — эта справка не заверяется физической
  // печатью, только QR-кодом проверки (Ethan, 19 сен 2026: "печати, подписи,
  // QR-коды — нужно так же обрабатывать").
  'Справка о несудимости': ['country', 'fullName', 'taxId', 'certificateStatus', 'identificationCode', 'issuanceNote', 'issuingAuthority', 'contactNote', 'documentNumber', 'formationDateTime', 'sourceSystemNote', 'legalValidityNote', 'actualityNote', 'formedByAuthority', 'signatureDate', 'signatureCode', 'qrCode', 'stampText'],
  'Аттестат': ['country', 'documentType', 'fullName', 'birthDate', 'birthPlace', 'institution', 'locality', 'graduationYear', 'documentNumber', 'issueDate', 'registrationNumber', 'educationLanguage', 'director', 'deputyDirector', 'classTeacher', 'seal', 'signature', 'verificationUrl', 'subjectsAndGrades', 'finalExamsAndGrades', 'stampText'],
  'Диплом / аттестат': ['fullName', 'institution', 'documentNumber', 'issueDate', 'seal', 'signature', 'stampText'],
  'Справка': ['documentType', 'fullName', 'birthDate', 'issueDate', 'issuingAuthority', 'seal', 'signature', 'stampText'],
  'Договор': ['documentType', 'documentNumber', 'date', 'partyOne', 'partyTwo', 'subject', 'amount', 'validityPeriod'],
  'Доверенность': ['fullName', 'documentNumber', 'powers', 'issueDate', 'expiryDate', 'issuingAuthority', 'seal', 'signature', 'stampText'],
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
    return {
      key,
      label: definition.label,
      ...(definition.kind ? { kind: definition.kind } : {}),
      // hint — необязательная дополнительная подсказка ДЛЯ GEMINI (не для
      // рендера/UI), см. комментарий у restrictionsText/pageSerialNumber
      // выше: пробрасывается через buildCombinedInstruction (pipeline.js)
      // как fieldHints, отдельно от общего списка лейблов.
      ...(definition.hint ? { hint: definition.hint } : {})
    };
  });
}

const TYPE_REGISTRY = Object.fromEntries([
  ['apostille', {
    label: 'Апостиль',
    fields: APOSTILLE_FIELDS,
    hint: 'an apostille certificate headed Apostille or Апостиль',
    preservesParagraphs: false
  }],
  // Отдельная запись, как у apostille выше — НЕ выводится из DOC_TYPES
  // (lib/docSchema.js), потому что тот список общий с основным
  // распознаванием (recognize.js) и не должен обрастать вариантами по
  // странам. Тип существует только для модуля "Перевод": Ethan, 19 сен
  // 2026 — паспорт Канады получает свою собственную вёрстку (не вариант
  // общей ID-карты), т.к. структура страницы (Тип/Код/Номер паспорта
  // отдельной строкой, плюс опциональная страница "Оговорки и
  // ограничения") заметно отличается от универсальной ID-карты — см.
  // passportCanadaDocx.mjs.
  ['Паспорт Канады', {
    label: 'Паспорт Канады',
    fields: genericFields(STANDARD_TRANSLATION_FIELDS['Паспорт Канады']),
    hint: 'the biodata page of a CANADIAN passport specifically — issuing country "CANADA", ICAO document type "P" and country code "CAN" printed in a Type/Code/Passport No. row, Canadian coat of arms, MRZ starting with "P<CAN". Use the generic "Паспорт / удостоверение личности" instead for any other country\'s passport or a non-passport ID document.',
    preservesParagraphs: false
  }],
  // Тот же приём, что у "Паспорт Канады" выше — две отдельные записи вне
  // DOC_TYPES, потому что этот список общий с основным распознаванием.
  // Ethan, 19 сен 2026: прислал один файл с ДВУМЯ разными реальными
  // переводами бюро — старый бумажный паспорт Узбекистана (без фото и MRZ)
  // и современный биометрический (с фото, Тип/Код/Номер, MRZ) — оба нужны
  // как отдельные типы, см. passportUzbekistanOldDocx.mjs /
  // passportUzbekistanDocx.mjs.
  ['Паспорт Узбекистана (старого образца)', {
    label: 'Паспорт Узбекистана (старого образца)',
    fields: genericFields(STANDARD_TRANSLATION_FIELDS['Паспорт Узбекистана (старого образца)']),
    // Hint описывает ИСХОДНЫЙ документ, который загружает клиент (реальный
    // паспорт на узбекском языке), а НЕ уже переведённый бюро образец, с
    // которого снята вёрстка рендера ниже — это разные вещи. Первая версия
    // подсказки ошибочно повторяла русские подписи бюровского перевода
    // ("РЕСПУБЛИКА УЗБЕКИСТАН", "Фамилия/Имя/Отчество...") — из-за этого
    // Gemini не узнавал настоящую страницу паспорта (она на узбекском
    // латинскими буквами, ни одного русского слова) и не классифицировал
    // её вообще ни в один тип (Ethan, 19 сен 2026, живой кейс с реальным
    // фото паспорта — верхняя страница пропала из перевода целиком).
    // Исправлено на реальные узбекские подписи с фото настоящего паспорта.
    hint: 'the personal-data page (page 2) of a modern Uzbekistan passport booklet, written ENTIRELY IN UZBEK (Latin script) with NO English or Russian — headed "O\'ZBEKISTON RESPUBLIKASI", with fields labeled FAMILIYASI (surname), ISMI (given name), OTASINING ISMI (patronymic), JINSI (sex), TUG\'ILGAN SANASI (date of birth), TUG\'ILGAN JOYI (place of birth), MILLATI (nationality/ethnicity), KIM TOMONIDAN BERILGAN (issuing authority), and a bilingual "SHAXSIY IMZO / HOLDER\'S SIGNATURE" line with an actual signature and a round ink seal. NO photo box, NO row labeled TURI/TYPE — DAVLAT KODI/COUNTRY CODE — PASPORT RAQAMI/PASSPORT No., and NO machine-readable zone (MRZ) anywhere on the page. If the page has a photo box, that TYPE/CODE/PASSPORT No. row, or an MRZ, use "Паспорт Узбекистана (биометрический)" instead.',
    preservesParagraphs: false
  }],
  ['Паспорт Узбекистана (биометрический)', {
    label: 'Паспорт Узбекистана (биометрический)',
    fields: genericFields(STANDARD_TRANSLATION_FIELDS['Паспорт Узбекистана (биометрический)']),
    // Тот же принцип, что и у старого образца выше — подсказка описывает
    // РЕАЛЬНУЮ (двуязычную узбекско-английскую) страницу паспорта, а не
    // русские подписи бюровского перевода.
    hint: 'the biodata page (page 3) of a modern BIOMETRIC Uzbekistan passport, headed bilingually "O\'ZBEKISTON RESPUBLIKASI / REPUBLIC OF UZBEKISTAN", with a row labeled TURI/TYPE — DAVLAT KODI/COUNTRY CODE — PASPORT RAQAMI/PASSPORT No. (ICAO document type "P", country code "UZB"), a photo box next to the word PASPORT/PASSPORT, bilingual Uzbek/English field labels (FAMILIYASI/SURNAME, ISMI/GIVEN NAMES, FUQAROLIGI/NATIONALITY, TUG\'ILGAN SANASI/DATE OF BIRTH, TUG\'ILGAN JOYI/PLACE OF BIRTH, JINSI/SEX, BERILGAN SANASI/DATE OF ISSUE, AMAL QILISH MUDDATI/DATE OF EXPIRY, PERSONALLASHTIRISH ORGANI/AUTHORITY), and a machine-readable zone (MRZ) starting with "P<UZB". If the page has no photo box, no TYPE/CODE/PASSPORT No. row and no MRZ, use "Паспорт Узбекистана (старого образца)" instead (or the generic "Паспорт / удостоверение личности" for any other country).',
    preservesParagraphs: false
  }],
  // Отдельная запись, тот же приём, что у "Паспорт Канады"/паспортов
  // Узбекистана выше — НЕ выводится из DOC_TYPES: это документ портала
  // "Тундук", не имеет отношения к общему /api/recognize и не должен
  // раздувать общий список DOC_TYPES/DOC_FIELDS (bucketируется отдельно от
  // generic "Справка", т.к. structurally совсем другой документ — не
  // бланк-подтверждение с реквизитами организации, а распечатка e-gov
  // портала с кодом идентификации/электронной подписью). Hint описывает
  // РЕАЛЬНЫЙ исходный документ (Тундук-справку на кыргызском/русском,
  // которую загрузит клиент) по общим признакам формата портала "Тундук" —
  // фото самого исходника (до перевода бюро) Ethan не присылал, только
  // готовый английский перевод, так что это ЛУЧШЕЕ ПРИБЛИЖЕНИЕ по общему
  // знанию формата, не проверено на реальном скане; если классификация
  // будет путать этот тип с чем-то ещё — hint нужно поправить по реальному
  // фото.
  ['Справка о несудимости', {
    label: 'Справка о несудимости',
    fields: genericFields(STANDARD_TRANSLATION_FIELDS['Справка о несудимости']),
    hint: 'an official certificate generated by the Kyrgyz Republic\'s "Тундук" (Tunduk) state electronic services portal, confirming whether a named person has a criminal record ("судимость") in the Kyrgyz Republic — headed with the Kyrgyz Republic state coat of arms, referencing the Ministry of Internal Affairs (МВД), and containing the applicant\'s full name and PIN, a "Результат"/"SERVICE RESULT" statement of the finding, an identification code, a document number, a QR code for verification, and an electronic-signature block (signature date and code, e-signature notice). Distinct from the generic "Справка" (an ordinary reference/confirmation letter for employment, income or residency with no e-government portal branding, QR code or electronic-signature block) and from civil registry certificates like "Свидетельство о рождении"/"Свидетельство о смерти".',
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
