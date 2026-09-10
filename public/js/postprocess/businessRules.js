// Базовые проверки бизнес-логики поверх УЖЕ извлечённых полей — премиум-опция
// (Ethan, 7 сен 2026, пример из обсуждения: "дата окончания раньше даты
// выдачи"). Это НЕ проверка правильности OCR как таковая (см. lib/confidence.js
// для самооценки модели) — это проверка логической согласованности между
// самими значениями полей, независимо от того, насколько уверенно они читались.
//
// ВАЖНО (Ethan, 10 сен 2026): с этой же логикой теперь есть серверная копия —
// lib/postprocess/businessRules.js (CommonJS-порт, 1:1). Эта, клиентская,
// копия остаётся нужна для МГНОВЕННОЙ перепроверки в браузере при ручном
// редактировании поля — без неё правки поля требовали бы round-trip на
// сервер. Серверная копия нужна, чтобы предупреждения видели ВСЕ каналы
// (публичный /api/v1/recognize, батчи), а не только веб-интерфейс — см.
// её комментарий. При изменении логики проверки правил — правьте ОБЕ копии.
//
// Два жёстко зашитых правила ниже — общих (применимых к любому карточному
// типу с датами выдачи/окончания: паспорт, права и т.п.), а не специфичных
// под один тип документа. Табличные типы (накладная, счёт-фактура) сюда не
// попадают вообще: у них нет "Дата выдачи"/"Дата окончания" в схеме (см.
// docSchema.js) — findValue просто не найдёт эти подписи.
//
// Настраиваемые правила (Ethan, 7 сен 2026, "чтобы сами компании делали их
// под свои нужды") — clientRules, второй параметр checkBusinessRules,
// приходит из конфига клиента в Supabase (formatting.businessRules, см.
// lib/customFieldsLookup.js:getClientConfig, задаётся через /admin или
// /settings — самообслуживание клиента). Изначально (7 сен) Ethan выбрал
// ОДИН тип правил — процентное соотношение между двумя полями (пример:
// "сумма НДС ≈ 12% от суммы"). 8 сен, после явного вопроса про свободные
// формулы клиента (сумма чисел, "любая логика") — принцип остался тем же
// (конструктор из готовых типов, НЕ мини-язык вычислений — Ethan сам выбрал
// этот вариант, увидев пример заготовленного списка правил), но набор
// расширен до пяти: percentage_match, sum_match (сумма полей ≈ другое поле),
// date_order (порядок ЛЮБЫХ двух дат — обобщение правила ниже), required_field
// (поле не пустое), range_check (числовое поле в диапазоне). См. RULE_CHECKERS.
//
// level: 'error' — вероятная ошибка распознавания (одна из дат/значений
// прочитана неверно), 'info' — не ошибка, а факт о документе, который стоит
// знать (например, срок действия истёк).

function findValue(fields, label) {
  const f = Array.isArray(fields) ? fields.find(x => x.label === label) : null;
  return f ? f.value : null;
}

// Понимает оба формата, которые может отдать normalizeDateValue на сервере
// (см. lib/fieldFormat.js) — ДД.ММ.ГГГГ (по умолчанию) и ГГГГ-ММ-ДД (если у
// клиента formatting.dateFormat='YYYY-MM-DD'), а также то, что человек мог
// вписать вручную после редактирования поля в интерфейсе. Не понимает
// текстовые даты вида "12 января 1990" — как и normalizeDateValue, такие
// значения не трогаем, а не гадаем.
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

// Разбирает денежное значение поля в число. Документы/клиенты используют то
// запятую, то точку как десятичный разделитель (см. formatting.decimalSeparator,
// lib/fieldFormat.js:normalizeAmountValue) и могут содержать разделители тысяч
// (пробел, точка или запятая — в зависимости от того, что не занято под
// десятичный) плюс произвольный текст вокруг числа (валюта, "сом", пробелы).
// Не гадаем агрессивно: если после очистки осталось не одно валидное
// число — возвращаем null, правило просто не сработает для этой пары полей
// (та же философия "молча пропускаем", что и у parseDate выше).
function parseAmount(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[^\d,.\-\s]/g, '').replace(/\s/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Оба разделителя — последний по позиции считаем десятичным, остальные
    // вхождения другого символа — разделители тысяч, убираем их.
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    s = s.replace(',', '.'); // одна запятая — десятичный разделитель (стандарт КР/РФ)
  }
  // Одна точка (или ни одной) — уже валидный десятичный формат, не трогаем.

  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

// Допуск по умолчанию, если клиент не задал свой в /admin — 1 процентный
// пункт ОТ ПОЛЯ-БАЗЫ (не от ожидаемого процента), та же единица измерения,
// что и сам expectedPercent — см. checkPercentageMatch ниже.
const DEFAULT_TOLERANCE_PERCENT = 1;

// rule — { type: 'percentage_match', baseField, valueField, expectedPercent,
// tolerancePercent?, level? } — один настроенный клиентом через /admin ряд
// (см. public/admin/admin.js, lib/customFieldsLookup.js:getClientConfig —
// там же уже отфильтрованы/зажаты некорректные значения из БД, здесь
// дополнительно подстраховываемся на случай прямой правки в Supabase).
// Возвращает {level, message} | null — null, если оба поля не нашлись, не
// оказались числами, или значение укладывается в допуск (замечаний нет).
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

// rule — { type: 'sum_match', sumFields: [...], targetField, tolerancePercent?,
// level? } — Ethan, 8 сен 2026: "чтобы он посчитал сумму всех числе" (сумма
// строк документа должна сходиться с итоговым полем). Если ХОТЯ БЫ ОДНО из
// sumFields не нашлось/не число — молча пропускаем (та же философия, что и
// у percentage_match: лучше не проверить, чем посчитать сумму по неполным
// данным и выдать ложное замечание).
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

// rule — { type: 'date_order', earlierField, laterField, level? } —
// обобщение изначально жёстко зашитого правила "дата выдачи не позже даты
// окончания" на ЛЮБУЮ пару дат клиента (Ethan, 8 сен 2026).
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

// rule — { type: 'required_field', field, level? } — единственный тип
// правила, который срабатывает на ПУСТОЕ значение (остальные молча
// пропускают проверку при отсутствии данных — здесь отсутствие данных и
// есть предмет проверки).
function checkRequiredField(fields, rule) {
  const value = findValue(fields, rule.field);
  if (value && String(value).trim()) return null;

  const level = rule.level === 'info' ? 'info' : 'error';
  return { level, message: `Поле «${rule.field}» не заполнено.` };
}

// rule — { type: 'range_check', field, min, max, level? } — min/max: число
// или null (граница не задана). Если поле не нашлось/не число — молча
// пропускаем (нечего сравнивать с диапазоном).
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

// Диспетчер по типу правила — единственное место, которое нужно расширить,
// когда появится новый тип (Ethan, 8 сен 2026: список типов согласован явно,
// НЕ свободные формулы клиента — конструктор из готовых типов остаётся
// принципом, просто расширен с одного до пяти типов).
const RULE_CHECKERS = {
  percentage_match: checkPercentageMatch,
  sum_match: checkSumMatch,
  date_order: checkDateOrder,
  required_field: checkRequiredField,
  range_check: checkRangeCheck
};

// clientRules — настроенные клиентом правила (см. выше), по умолчанию [] —
// вызовы без второго аргумента (если где-то остались) работают как раньше,
// только со встроенными двумя правилами дат.
// Возвращает [{ level, message }, ...] — пустой массив, если проверять
// нечего или замечаний не нашлось.
export function checkBusinessRules(fields, clientRules = [], docType = null) {
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
      if (!checker) return; // неизвестный тип — молча пропускаем (уже отфильтрован на чтении/записи, но не гадаем)
      const result = checker(fields, rule);
      if (result) warnings.push(result);
    });
  }

  return warnings;
}

