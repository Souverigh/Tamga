// Нормализация значений УЖЕ ИЗВЛЕЧЁННЫХ полей (fields) и строк таблицы (items).
// Не путать с public/js/postprocess/textCleanup.js — та нормализация работает
// только с сырым OCR-текстом на панели «Текст» и не касается структурированных
// данных, которые уходят в Excel/PDF. Этот модуль — единственное место, где
// приводятся к единому виду именно значения полей, отдаваемые из recognizeDocument.
//
// Роль поля определяется по его подписи (то же самое, что уже делает
// heuristicExtractor.js для офлайн-режима: 'дата' → дата, 'сумма'/'цена' → сумма) —
// так консистентность подхода сохраняется между online- и offline-путями.

function detectRole(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('дата')) return 'date';
  if (l.includes('сумма') || l.includes('цена')) return 'amount';
  return null;
}

// Приводит дату к ДД.ММ.ГГГГ. Понимает как порядок КР/РФ (Д.М.Г), так и ISO (Г-М-Д).
// Требует 4-значный год — гадать век по двум цифрам ("90" → 1990 или 2090?)
// рискованнее, чем оставить значение как есть. Не трогает значения, которые не
// похожи на числовую дату (например, "12 января 1990" — такие форматы уже
// однозначны для человека, а гадать месяц по словам рискованнее, чем оставить как есть).
function normalizeDateValue(value) {
  if (!value) return value;
  const v = String(value).trim();

  let m = v.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/); // ISO: Г-М-Д
  if (m) {
    const [, y, mo, d] = m;
    const day = parseInt(d, 10), month = parseInt(mo, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${y}`;
    }
    return v;
  }

  m = v.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/); // КР/РФ: Д.М.Г (только 4-значный год —
  if (m) {                                                 // гадать век по 2 цифрам рискованнее, чем оставить как есть)
    const [, d, mo, y] = m;
    const day = parseInt(d, 10), month = parseInt(mo, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${y}`;
    }
  }

  return v;
}

// Приводит десятичный разделитель к запятой (стандарт КР/РФ) — та же логика,
// что normalizeNumbers в textCleanup.js, но применяется к отдельному значению поля.
function normalizeAmountValue(value) {
  if (!value) return value;
  return String(value).replace(/(\d)\.(\d{1,2})(?!\d)/g, '$1,$2');
}

function normalizeValueByLabel(label, value) {
  const role = detectRole(label);
  if (role === 'date') return normalizeDateValue(value);
  if (role === 'amount') return normalizeAmountValue(value);
  return value;
}

function normalizeFields(fields) {
  if (!Array.isArray(fields)) return fields;
  return fields.map(f => ({ ...f, value: normalizeValueByLabel(f.label, f.value) }));
}

// docType нужен, чтобы узнать колонки этого табличного типа (columnsForType/keysForType) —
// роль колонки определяется по её русской подписи, так же как для плоских полей выше.
function normalizeItems(items, docType, columnsForType, keysForType) {
  if (!Array.isArray(items) || !items.length) return items;
  const columns = columnsForType(docType);
  const keys = keysForType(docType);
  if (!columns || !keys) return items;

  const roleByKey = {};
  keys.forEach((k, i) => { roleByKey[k] = detectRole(columns[i]); });

  return items.map(item => {
    const out = { ...item };
    keys.forEach(k => {
      const role = roleByKey[k];
      if (role === 'date') out[k] = normalizeDateValue(out[k]);
      if (role === 'amount') out[k] = normalizeAmountValue(out[k]);
    });
    return out;
  });
}

module.exports = { normalizeFields, normalizeItems, normalizeDateValue, normalizeAmountValue };
