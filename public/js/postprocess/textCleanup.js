// Постобработка распознанного текста. Не знает, откуда пришёл текст
// (Tesseract или Gemini) — работает с готовой строкой.

const MONTHS_GENITIVE = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

// Даты вида Д.М, ДД/ММ, ДД-ММ[.ГГГГ] — считаем первое число днём, второе месяцем (стандарт КР/РФ)
export function normalizeDates(text) {
  return text.replace(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\b/g, (match, d, m, y) => {
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    if (day < 1 || day > 31 || month < 1 || month > 12) return match; // не похоже на дату — не трогаем
    let result = `${day} ${MONTHS_GENITIVE[month - 1]}`;
    if (y) {
      const year = y.length === 2 ? '20' + y : y; // упрощение: считаем двузначный год 2000-ми
      result += ` ${year}`;
    }
    return result;
  });
}

// Дробные числа с точкой или запятой (12.5 / 12,5) — приводим к запятой, стандарт для КР/РФ
export function normalizeNumbers(text) {
  return text.replace(/\b(\d+)\.(\d{1,2})\b/g, '$1,$2');
}

// Типичный мусор OCR: невидимые управляющие символы, следы линий/рамок таблицы на скане,
// повторяющаяся пунктуация от артефактов распознавания, лишние пробелы и пустые строки.
// Делает текст читаемым, не трогая сами буквы и цифры.
export function cleanupOcrNoise(text) {
  let out = text;
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); // непечатаемые символы
  out = out.replace(/[\u00A6\u00AC\u2020\u2021~|]+/g, '');                  // одиночный мусор вроде |, ~, ¦, †
  out = out.replace(/\.{4,}/g, '…');    // длинные ряды точек (следы линий на скане) → многоточие
  out = out.replace(/-{4,}/g, '—');     // длинные ряды дефисов → тире
  out = out.replace(/_{3,}/g, '');      // подчёркивания от рамок/полей для заполнения
  out = out.replace(/={3,}/g, '');
  out = out.replace(/([!?,;:])\1{1,}/g, '$1'); // повторы пунктуации: "!!!" → "!", ",," → ","
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

// Сначала очистка мусора, потом даты — иначе точка в дате (12.01) будет
// по ошибке принята за десятичное число, если порядок перепутать.
export function postProcessText(text, { cleanup, normalize }) {
  let out = text;
  if (cleanup) out = cleanupOcrNoise(out);
  if (normalize) {
    out = normalizeDates(out);
    out = normalizeNumbers(out);
  }
  return out;
}
