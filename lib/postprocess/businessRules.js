// Серверный порт public/js/postprocess/businessRules.js (Ethan, 10 сен 2026,
// "бизнес-правила видит только сайт, публичный API/вебхуки — нет").
//
// ВАЖНО: логика этого файла ДОЛЖНА оставаться синхронной с клиентской копией
// (public/js/postprocess/businessRules.js) — та же идея дублирования, что у
// lib/docSchema.js / public/js/config/docSchema.js (см. комментарий там).
// Единственное отличие — синтаксис модулей (CommonJS здесь, ES module там),
// сама логика проверок скопирована 1:1, без изменений.
//
// Зачем два места, а не одно общее: клиентская копия нужна для МГНОВЕННОЙ
// перепроверки в браузере при ручном редактировании поля пользователем — без
// неё каждое исправление значения требовало бы round-trip на сервер. Эта,
// серверная копия нужна, чтобы предупреждения были видны ВСЕМ каналам
// (веб-интерфейс, публичный /api/v1/recognize, батчи), а не только тем, кто
// прошёл через браузер — раньше публичный API и вебхуки бизнес-правила вообще
// не видели, хотя клиент их для этого настраивал в /admin или /settings.
//
// level: 'error' — вероятная ошибка распознавания, 'info' — не ошибка, а
// факт о документе (например, срок действия истёк).

function findValue(fields, label) {
  const f = Array.isArray(fields) ? fields.find(x => x.label === label) : null;
  return f ? f.value : null;
}

// Понимает оба формата, которые может отдать normalizeDateValue (см.
// lib/fieldFormat.js) — ДД.ММ.ГГГГ (по умолчанию) и ГГГГ-ММ-ДД (если у
// клиента formatting.dateFormat='YYYY-MM-DD'). Не понимает текстовые даты
// вида "12 января 1990" — такие значения не трогаем, а не гадаем.
function parseDate(value) {
  if (!value) return null;
  const v = String(value).trim();

  let m = v.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/); // ГГГГ-ММ-ДД
  if (m) {
    const [, y, mo, d] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  m = v.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/); // ДД.ММ.ГГГГ
  if (m) {
    const [, d, mo, y] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

// Разбирает денежное значение поля в число — понимает запятую/точку как
// десятичный разделитель, разделители тысяч, произвольный текст вокруг числа
// (валюта, "сом"). Если после очистки осталось не одно валидное число —
// возвращает null (правило просто не сработает для этой пары полей).
function parseAmount(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[^\d,.\-\s]/g, '').replace(/\s/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    s = s.replace(',', '.');
  }

  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

const DEFAULT_TOLERANCE_PERCENT = 1;

function checkPercentageMatch(fields, rule) {
  const baseValue = parseAmount(findValue(fields, rule.baseField));
  const checkedValue = parseAmount(findValue(fields, rule.valueField));
  if (baseValue == null || checkedValue == null) return null;

  const expectedPercent = Number(rule.expectedPercent);
  if (!Number.isFinite(expectedPercent)) return null;
  const tolerancePercent = Number.isFinite(Number(rule.tolerancePercent)) ? Number(rule.tolerancePercent) : DEFAULT_TOLERANCE_PERCENT;

  const expectedValue = baseValue * expectedPercent / 100;
  const toleranceAmount = Math.abs(baseValue) * tolerancePercent / 100;
  if (Math.abs(checkedValue - expectedValue) <= toleranceAmount) return null;

  const level = rule.level === 'info' ? 'info' : 'error';
  const roundedExpected = Math.round(expectedValue * 100) / 100;
  return {
    level,
    message: `«${rule.valueField}» (${checkedValue}) не похоже на ${expectedPercent}% от «${rule.baseField}» (${baseValue}) — ожидалось ≈${roundedExpected}, проверьте вручную.`
  };
}

function checkSumMatch(fields, rule) {
  const addends = rule.sumFields.map(f => parseAmount(findValue(fields, f)));
  if (addends.some(v => v == null)) return null;
  const targetValue = parseAmount(findValue(fields, rule.targetField));
  if (targetValue == null) return null;

  const sum = addends.reduce((acc, v) => acc + v, 0);
  const tolerancePercent = Number.isFinite(Number(rule.tolerancePercent)) ? Number(rule.tolerancePercent) : DEFAULT_TOLERANCE_PERCENT;
  const toleranceAmount = Math.abs(targetValue) * tolerancePercent / 100;
  if (Math.abs(sum - targetValue) <= toleranceAmount) return null;

  const level = rule.level === 'info' ? 'info' : 'error';
  const roundedSum = Math.round(sum * 100) / 100;
  return {
    level,
    message: `Сумма полей «${rule.sumFields.join('», «')}» (${roundedSum}) не сходится с «${rule.targetField}» (${targetValue}), проверьте вручную.`
  };
}

function checkDateOrder(fields, rule) {
  const earlier = parseDate(findValue(fields, rule.earlierField));
  const later = parseDate(findValue(fields, rule.laterField));
  if (!earlier || !later) return null;
  if (earlier.getTime() <= later.getTime()) return null;

  const level = rule.level === 'info' ? 'info' : 'error';
  return {
    level,
    message: `«${rule.earlierField}» позже «${rule.laterField}» — вероятно, одна из дат распознана неверно, стоит проверить вручную.`
  };
}

function checkRequiredField(fields, rule) {
  const value = findValue(fields, rule.field);
  if (value && String(value).trim()) return null;

  const level = rule.level === 'info' ? 'info' : 'error';
  return { level, message: `Поле «${rule.field}» не заполнено.` };
}

function checkRangeCheck(fields, rule) {
  const value = parseAmount(findValue(fields, rule.field));
  if (value == null) return null;

  const level = rule.level === 'info' ? 'info' : 'error';
  if (rule.min != null && value < rule.min) {
    return { level, message: `«${rule.field}» (${value}) меньше минимума ${rule.min}, проверьте вручную.` };
  }
  if (rule.max != null && value > rule.max) {
    return { level, message: `«${rule.field}» (${value}) больше максимума ${rule.max}, проверьте вручную.` };
  }
  return null;
}

const RULE_CHECKERS = {
  percentage_match: checkPercentageMatch,
  sum_match: checkSumMatch,
  date_order: checkDateOrder,
  required_field: checkRequiredField,
  range_check: checkRangeCheck
};

// fields — result.fields из recognizeDocument (карточные поля ЛИБО totals
// табличного типа — обе формы это плоский массив {label, value}, см.
// lib/fieldFormat.js). clientRules — clientConfig.businessRules (уже
// провалидированы при чтении, см. customFieldsLookup.js). docType —
// result.documentType, для фильтра rule.docTypes.
// Возвращает [{ level, message }, ...] — пустой массив, если нечего
// проверять или замечаний не нашлось.
function checkBusinessRules(fields, clientRules = [], docType = null) {
  const warnings = [];
  const issue = parseDate(findValue(fields, 'Дата выдачи'));
  const expiry = parseDate(findValue(fields, 'Дата окончания'));

  if (issue && expiry && issue.getTime() > expiry.getTime()) {
    warnings.push({
      level: 'error',
      message: 'Дата выдачи позже даты окончания — вероятно, одна из дат распознана неверно, стоит проверить вручную.'
    });
  }

  if (expiry) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (expiry.getTime() < today.getTime()) {
      warnings.push({ level: 'info', message: 'Срок действия документа истёк.' });
    }
  }

  if (Array.isArray(clientRules)) {
    clientRules.forEach(rule => {
      if (rule && rule.docTypes !== undefined && (!Array.isArray(rule.docTypes) || !rule.docTypes.includes(docType))) return;
      const checker = rule && RULE_CHECKERS[rule.type];
      if (!checker) return;
      const result = checker(fields, rule);
      if (result) warnings.push(result);
    });
  }

  return warnings;
}

module.exports = { checkBusinessRules };
