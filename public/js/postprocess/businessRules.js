// Базовые проверки бизнес-логики поверх УЖЕ извлечённых полей — премиум-опция
// (Ethan, 7 сен 2026, пример из обсуждения: "дата окончания раньше даты
// выдачи"). Это НЕ проверка правильности OCR как таковая (см. lib/confidence.js
// для самооценки модели) — это проверка логической согласованности между
// самими значениями полей, независимо от того, насколько уверенно они читались.
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
// lib/customFieldsLookup.js:getClientConfig, задаётся через /admin —
// public/admin/admin.js). Ethan явно выбрал ОДИН тип правил для первой
// версии — процентное соотношение между двумя полями (пример: "сумма НДС ≈
// 12% от суммы") — а не полностью свободные формулы клиента: конструктор из
// готовых типов безопаснее и предсказуемее, чем мини-язык вычислений внутри
// админки. Остальные обсуждавшиеся типы (порядок двух произвольных дат,
// "поле не должно быть пустым") в эту версию не вошли — см. TECH_DEBT.md.
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

// clientRules — настроенные клиентом правила (см. выше), по умолчанию [] —
// вызовы без второго аргумента (если где-то остались) работают как раньше,
// только со встроенными двумя правилами дат.
// Возвращает [{ level, message }, ...] — пустой массив, если проверять
// нечего или замечаний не нашлось.
export function checkBusinessRules(fields, clientRules = []) {
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
      if (!rule || rule.type !== 'percentage_match') return; // единственный поддерживаемый тип в первой версии
      const result = checkPercentageMatch(fields, rule);
      if (result) warnings.push(result);
    });
  }

  return warnings;
}

