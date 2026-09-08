// Поиск возможных дублей внутри одной пачки — сравнение УЖЕ извлечённых
// полей (номер документа, либо ФИО+дата как запасной вариант), без единого
// нового запроса к серверу/Gemini — та же экономия, что у checkBusinessRules
// (postprocess/businessRules.js): работаем с тем, что уже есть в браузере
// после распознавания пачки, никакого влияния на скорость распознавания.
//
// Ethan (7 сен 2026): "поиск дублей внутри пачки" — очередной пункт остатка
// премиум-списка. Развилка обсуждена явно: сравнение по СМЫСЛОВЫМ полям
// (номер документа, либо ФИО+дата как запасной вариант), а не по буквальному
// совпадению распознанного текста страницы — OCR редко даёт побайтово
// идентичный текст даже для одного и того же скана при повторном прогоне
// (лишние пробелы, другой перенос строки, иначе прочитанный символ), так что
// сравнение сырого текста давало бы много ложноотрицательных случаев на
// реальных дублях.
//
// Табличные типы (накладная, счёт-фактура и т.п.) НЕ участвуют — у них нет
// карточных полей вообще (fields=[], только items) — сравнивать нечего, то
// же самое ограничение, что у checkBusinessRules.
//
// Известное ограничение первой версии: дубли считаются ОДИН РАЗ, по
// исходной классификации при первом рендере пачки (см. ui/results.js) — если
// пользователь вручную сменит тип документа у одной из карточек ПОСЛЕ этого,
// предупреждения о дублях не пересчитаются (в отличие от checkBusinessRules,
// которые пересчитываются на смену типа для ОДНОЙ карточки — но не имеют
// доступа к полям остальных файлов пачки, а полный пересчёт по всей пачке
// на каждую смену типа усложнил бы первую версию непропорционально пользе).

// Для каждого карточного типа: number — поле-идентификатор документа
// (серия/номер и т.п.), совпадение которого ОДНО уже означает дубль;
// name/date — запасной вариант, когда номер пуст в ОБОИХ файлах (например,
// скан обрезан и серия/номер не попали в кадр) — тогда дублем считаем
// совпадение ФИО (или сторон сделки) И даты одновременно. name может быть
// массивом из нескольких лейблов (например, оба супруга) — тогда все
// значения должны совпасть. null у name — запасного варианта для этого типа
// нет вообще: поле недостаточно идентифицирующее само по себе (например,
// "Краткое содержание" у "Другое" — это свободное описание, не identity).
const IDENTITY_FIELDS = {
  'Паспорт / удостоверение личности': { number: 'Серия и номер', name: 'ФИО', date: 'Дата рождения' },
  'Водительское удостоверение': { number: 'Серия и номер', name: 'ФИО', date: 'Дата рождения' },
  'Военный билет': { number: 'Серия и номер', name: 'ФИО', date: 'Дата рождения' },
  'Свидетельство о рождении': { number: 'Серия и номер', name: 'ФИО ребёнка', date: 'Дата рождения' },
  'Свидетельство о браке': { number: 'Серия и номер', name: ['ФИО супруга', 'ФИО супруги'], date: 'Дата заключения брака' },
  'Свидетельство о расторжении брака': { number: 'Серия и номер', name: ['ФИО супруга', 'ФИО супруги'], date: 'Дата расторжения брака' },
  'Свидетельство о смерти': { number: 'Серия и номер', name: 'ФИО умершего', date: 'Дата смерти' },
  'Диплом / аттестат': { number: 'Регистрационный номер', name: 'ФИО', date: 'Дата выдачи' },
  'Справка': { number: 'Номер', name: 'Кому выдана', date: 'Дата выдачи' },
  'Договор': { number: 'Номер договора', name: 'Стороны', date: 'Дата заключения' },
  'Доверенность': { number: 'Номер (нотариальный)', name: ['Доверитель', 'Доверенное лицо'], date: 'Дата выдачи' },
  'Банковский документ': { number: 'Номер счёта / IBAN', name: 'Владелец счёта', date: 'Дата операции' },
  'Платёжное поручение': { number: 'Номер поручения', name: ['Плательщик', 'Получатель'], date: 'Дата' },
  'Квитанция / чек': { number: 'Номер чека', name: 'Продавец', date: 'Дата' },
  // VIN, а не "Серия и номер" — для автомобиля это более надёжный уникальный
  // идентификатор; запасного варианта по ФИО+дата для этого типа нет
  // ("Владелец" без надёжной даты рядом — слабое основание для identity).
  'Техпаспорт автомобиля': { number: 'VIN', name: null, date: null },
  'Документы на недвижимость': { number: 'Кадастровый номер', name: 'Собственник', date: 'Дата выдачи' },
  // "Краткое содержание" — свободное описание, не идентифицирующее поле,
  // запасного варианта для "Другое" нет: сравниваем только по номеру.
  'Другое': { number: 'Номер', name: null, date: null }
};

function findValue(fields, label) {
  const f = Array.isArray(fields) ? fields.find(x => x.label === label) : null;
  return f ? f.value : null;
}

// Нормализация ТОЛЬКО для сравнения (не для отображения/экспорта): убираем
// лишние пробелы и приводим к верхнему регистру — устойчиво к тому, что одна
// и та же серия/номер/ФИО иногда распознаётся с иным регистром или лишним
// пробелом между блоками (OCR-шум), при этом исходные значения полей не
// трогаем нигде за пределами этого сравнения.
function normalizeIdentityValue(value) {
  return String(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

// nameSpec — один лейбл или массив лейблов (несколько сторон). Возвращает
// null, если хотя бы одно из значений пусто — частично пустой набор ФИО не
// считается надёжным основанием для identity (лучше не найти дубль, чем
// склеить двух разных людей по одному общему пустому полю).
function readNameValue(fields, nameSpec) {
  if (!nameSpec) return null;
  const labels = Array.isArray(nameSpec) ? nameSpec : [nameSpec];
  const values = labels.map(l => findValue(fields, l));
  if (values.some(v => !v || !String(v).trim())) return null;
  return values.map(normalizeIdentityValue).join('|');
}

// Запасной вариант для типов БЕЗ записи в IDENTITY_FIELDS — то есть для
// любого кастомного типа клиента (Ethan, 8 сен 2026: "прислал документ
// медицинской страховки 3 раза, дублей не нашла" — IDENTITY_FIELDS вообще
// не знает о кастомных типах, до этой правки они молча пропускались целиком,
// см. историю ниже). Для кастомного типа своей карты "что здесь номер, а что
// ФИО" нет и быть не может — поля называет сам клиент как угодно через
// /admin. Поэтому вместо identity-поля сравниваем ВСЕ поля документа целиком:
// если каждое поле (по лейблу) совпадает буквально после нормализации — это
// дубль. Надёжно ловит "прислал тот же файл ещё раз" (самый частый случай на
// практике), не пытаясь угадать, какое из произвольных полей клиента — это
// уникальный идентификатор (риск ложного срабатывания на двух РАЗНЫХ, но
// частично похожих документах одного кастомного типа этим сознательно не
// берём на себя — лучше пропустить редкий дубль, чем склеить два разных
// документа между собой).
function genericFieldsMatch(fieldsA, fieldsB) {
  if (!Array.isArray(fieldsA) || !Array.isArray(fieldsB) || !fieldsA.length || fieldsA.length !== fieldsB.length) return false;
  const mapA = new Map(fieldsA.map(f => [f.label, f.value]));
  const mapB = new Map(fieldsB.map(f => [f.label, f.value]));
  if (mapA.size !== mapB.size) return false;

  let hasNonEmpty = false;
  for (const [label, valueA] of mapA) {
    if (!mapB.has(label)) return false; // разный набор полей — не сравниваем вообще (не должно случаться для одного и того же типа, но не гадаем)
    const valueB = mapB.get(label);
    const normA = valueA ? normalizeIdentityValue(valueA) : '';
    const normB = valueB ? normalizeIdentityValue(valueB) : '';
    if (normA !== normB) return false;
    if (normA) hasNonEmpty = true;
  }
  // Все поля пусты в обоих документах — не основание считать их дублями
  // (два одинаково нечитабельных скана разных документов дадут ту же картину).
  return hasNonEmpty;
}

// fileResults — тот же массив, что передаётся в showResults() (см.
// ui/results.js): [{fileName, docType, fields, ...}, ...].
// Возвращает Map<fileName, [{duplicateOf, reason}, ...]> — массив, а не
// одна запись, т.к. в пачке может быть 3+ копий одного документа.
export function findDuplicates(fileResults) {
  const result = new Map();
  if (!Array.isArray(fileResults)) return result;

  for (let i = 0; i < fileResults.length; i++) {
    for (let j = i + 1; j < fileResults.length; j++) {
      const a = fileResults[i];
      const b = fileResults[j];
      if (a.docType !== b.docType) continue; // сравниваем только документы одного типа
      const identity = IDENTITY_FIELDS[a.docType];

      let reason = null;

      if (!identity) {
        // Кастомный тип клиента (или любой другой не описанный явно тип) —
        // см. genericFieldsMatch выше. Табличные типы сюда естественно не
        // попадают: у них fields=[] всегда, genericFieldsMatch на пустом
        // массиве сразу вернёт false.
        if (genericFieldsMatch(a.fields, b.fields)) {
          reason = 'все поля документа совпадают';
        }
      } else {
        const numA = findValue(a.fields, identity.number);
        const numB = findValue(b.fields, identity.number);
        if (numA && numB && String(numA).trim() && String(numB).trim()
            && normalizeIdentityValue(numA) === normalizeIdentityValue(numB)) {
          reason = `«${identity.number}» совпадает: "${String(numA).trim()}"`;
        } else if (!numA && !numB) {
          // Номер пуст в ОБОИХ файлах (не в одном — иначе один читаемый, другой
          // нет, это не основание считать их одинаковыми) — пробуем запасной
          // признак: ФИО/стороны И дата одновременно.
          const nameA = readNameValue(a.fields, identity.name);
          const nameB = readNameValue(b.fields, identity.name);
          const dateA = identity.date ? findValue(a.fields, identity.date) : null;
          const dateB = identity.date ? findValue(b.fields, identity.date) : null;
          if (nameA && nameB && nameA === nameB && dateA && dateB
              && String(dateA).trim() && String(dateB).trim()
              && normalizeIdentityValue(dateA) === normalizeIdentityValue(dateB)) {
            reason = 'ФИО и дата совпадают (номер документа не распознан ни на одном из файлов)';
          }
        }
      }

      if (reason) {
        if (!result.has(a.fileName)) result.set(a.fileName, []);
        if (!result.has(b.fileName)) result.set(b.fileName, []);
        result.get(a.fileName).push({ duplicateOf: b.fileName, reason });
        result.get(b.fileName).push({ duplicateOf: a.fileName, reason });
      }
    }
  }
  return result;
}
