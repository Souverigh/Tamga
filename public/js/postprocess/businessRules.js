// Базовые проверки бизнес-логики поверх УЖЕ извлечённых полей — премиум-опция
// (Ethan, 7 сен 2026, пример из обсуждения: "дата окончания раньше даты
// выдачи"). Это НЕ проверка правильности OCR как таковая (см. lib/confidence.js
// для самооценки модели) — это проверка логической согласованности между
// самими значениями полей, независимо от того, насколько уверенно они читались.
//
// Намеренно узкий набор правил для первой версии — общих (применимых к любому
// карточному типу с датами выдачи/окончания: паспорт, права и т.п.), а не
// специфичных под один тип документа. Табличные типы (накладная, счёт-фактура)
// сюда не попадают вообще: у них нет "Дата выдачи"/"Дата окончания" в схеме
// (см. docSchema.js) — findValue просто не найдёт эти подписи, checkBusinessRules
// молча вернёт [].
//
// level: 'error' — вероятная ошибка распознавания (одна из дат прочитана
// неверно), 'info' — не ошибка, а факт о документе, который стоит знать
// (например, срок действия истёк).

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

// Возвращает [{ level, message }, ...] — пустой массив, если проверять
// нечего (нет обеих дат, или не распарсились) или замечаний не нашлось.
export function checkBusinessRules(fields) {
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

  return warnings;
}
