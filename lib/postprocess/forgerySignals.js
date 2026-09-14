// Признаки подделки/редактирования документа — простые эвристики (Ethan,
// 13 сен 2026: банки/бухгалтерии, "предупреждение, требует внимания").
// НИ ОДИН из этих сигналов НЕ доказательство подделки сам по себе — телефон
// тоже пишет Software при HDR-обработке, а OCR тоже иногда путает цифру с
// буквой. Формулировки в message сознательно мягкие ("стоит проверить"),
// не "подделка обнаружена".
//
// Отдельный level:'suspicious' в result.warnings (см. lib/recognize.js) —
// не 'error'/'info' из businessRules.js, чтобы не путать с обычными
// проверками (несовпадающие даты, истёкший срок) и не красить цветом
// "ошибка распознавания" то, что на самом деле "проверьте оригинал".
//
// Фаза 1 — два независимых сигнала, БЕЗ отдельного vision-запроса:
// 1) EXIF-метаданные фото (exifr) — редактор в Software, либо файл изменён
//    заметно позже момента съёмки.
// 2) Формат идентификатора (ИНН/ПИН) — длина должна быть 10/12 (РФ) или
//    14 (КР) цифр.
//
// НЕ реализовано (см. TECH_DEBT.md): несовпадение шрифтов внутри документа —
// нужен визуальный анализ изображения, это отдельная задача, не дешёвая
// эвристика. Проверка формата ИНН/ПИН также НЕ продублирована в браузерном
// businessRules.js — не пересчитывается при ручном редактировании поля,
// только на исходном ответе recognizeDocument (см. TECH_DEBT.md).

const exifr = require('exifr');

const EDITING_SOFTWARE = /photoshop|gimp|paint\.?net|pixlr|affinity photo|illustrator/i;
const ID_LABEL = /ИНН|ПИН/i;
const VALID_ID_LENGTHS = new Set([10, 12, 14]);
const SUSPICIOUS_MODIFY_GAP_MS = 24 * 60 * 60 * 1000; // сутки — телефонная HDR-обработка укладывается в секунды/минуты

async function checkExifSignals(base64, mimeType) {
  if (mimeType !== 'image/jpeg') return []; // EXIF практически не встречается в PNG/WebP/PDF из нашего пайплайна
  let tags;
  try {
    const buffer = Buffer.from(base64, 'base64');
    tags = await exifr.parse(buffer, { pick: ['Software', 'ModifyDate', 'DateTimeOriginal', 'CreateDate'] });
  } catch (_) {
    return []; // повреждённый/усечённый EXIF — обычное дело, не ошибка приложения
  }
  if (!tags) return [];
  const warnings = [];
  if (tags.Software && EDITING_SOFTWARE.test(tags.Software)) {
    warnings.push({
      level: 'suspicious',
      message: `Файл обработан в графическом редакторе (${tags.Software}) — не обязательно подделка, но стоит свериться с оригиналом.`
    });
  }
  const taken = tags.DateTimeOriginal || tags.CreateDate;
  const modified = tags.ModifyDate;
  if (taken instanceof Date && modified instanceof Date && (modified.getTime() - taken.getTime()) > SUSPICIOUS_MODIFY_GAP_MS) {
    warnings.push({
      level: 'suspicious',
      message: 'Файл изменён заметно позже момента съёмки (по метаданным EXIF) — стоит свериться с оригиналом.'
    });
  }
  return warnings;
}

function checkIdentifierFormat(fields) {
  if (!Array.isArray(fields)) return [];
  const warnings = [];
  for (const f of fields) {
    if (!f || !ID_LABEL.test(f.label || '')) continue;
    const raw = String(f.value || '').trim();
    if (!raw) continue;
    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly.length !== raw.length) {
      warnings.push({ level: 'suspicious', message: `«${f.label}»: значение «${raw}» содержит не только цифры — проверьте вручную.` });
    } else if (!VALID_ID_LENGTHS.has(digitsOnly.length)) {
      warnings.push({ level: 'suspicious', message: `«${f.label}»: длина ${digitsOnly.length} цифр не соответствует стандарту КР (14) или РФ (10/12) — проверьте вручную.` });
    }
  }
  return warnings;
}

// НИКОГДА не бросает — вызывающий код (lib/recognize.js) не должен зависеть
// от результата этой проверки, только добавлять то, что она вернула.
async function checkForgerySignals({ base64, mimeType, fields }) {
  try {
    const exifWarnings = await checkExifSignals(base64, mimeType);
    return [...exifWarnings, ...checkIdentifierFormat(fields)];
  } catch (err) {
    console.error('forgerySignals: проверка недоступна —', err.message);
    return [];
  }
}

module.exports = { checkForgerySignals, checkIdentifierFormat, checkExifSignals };
