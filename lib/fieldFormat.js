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

// Приводит дату к целевому формату (по умолчанию ДД.ММ.ГГГГ — стандарт КР/РФ,
// либо ISO ГГГГ-ММ-ДД, если formatting.dateFormat так задаёт — см. конфиг
// клиента в customFieldsLookup.js). Понимает на входе как порядок КР/РФ (Д.М.Г),
// так и ISO (Г-М-Д), независимо от целевого формата. Требует 4-значный год —
// гадать век по двум цифрам ("90" → 1990 или 2090?) рискованнее, чем оставить
// значение как есть. Не трогает значения, которые не похожи на числовую дату
// (например, "12 января 1990" — такие форматы уже однозначны для человека,
// а гадать месяц по словам рискованнее, чем оставить как есть).
function normalizeDateValue(value, formatting) {
  if (!value) return value;
  const v = String(value).trim();
  const targetIso = formatting && formatting.dateFormat === 'YYYY-MM-DD';

  const format = (day, month, year) => targetIso
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;

  let m = v.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/); // ISO: Г-М-Д
  if (m) {
    const [, y, mo, d] = m;
    const day = parseInt(d, 10), month = parseInt(mo, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return format(day, month, y);
    return v;
  }

  m = v.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/); // КР/РФ: Д.М.Г (только 4-значный год —
  if (m) {                                                 // гадать век по 2 цифрам рискованнее, чем оставить как есть)
    const [, d, mo, y] = m;
    const day = parseInt(d, 10), month = parseInt(mo, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return format(day, month, y);
  }

  return v;
}

// Приводит десятичный разделитель к целевому (по умолчанию запятая — стандарт
// КР/РФ, либо точка, если formatting.decimalSeparator задаёт '.') — та же
// логика, что normalizeNumbers в textCleanup.js, но применяется к отдельному
// значению поля.
function normalizeAmountValue(value, formatting) {
  if (!value) return value;
  const targetSeparator = (formatting && formatting.decimalSeparator === '.') ? '.' : ',';
  return String(value).replace(/(\d)\.(\d{1,2})(?!\d)/g, targetSeparator === '.' ? '$1.$2' : '$1,$2');
}

function normalizeValueByLabel(label, value, formatting) {
  const role = detectRole(label);
  if (role === 'date') return normalizeDateValue(value, formatting);
  if (role === 'amount') return normalizeAmountValue(value, formatting);
  return value;
}

// formatting (опционально) — override из конфига клиента: { dateFormat, decimalSeparator }.
function normalizeFields(fields, formatting) {
  if (!Array.isArray(fields)) return fields;
  return fields.map(f => ({ ...f, value: normalizeValueByLabel(f.label, f.value, formatting) }));
}

// docType нужен, чтобы узнать колонки этого табличного типа (columnsForType/keysForType) —
// роль колонки определяется по её русской подписи, так же как для плоских полей выше.
function normalizeItems(items, docType, columnsForType, keysForType, formatting) {
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
      if (role === 'date') out[k] = normalizeDateValue(out[k], formatting);
      if (role === 'amount') out[k] = normalizeAmountValue(out[k], formatting);
    });
    return out;
  });
}

module.exports = { normalizeFields, normalizeItems, normalizeDateValue, normalizeAmountValue };
