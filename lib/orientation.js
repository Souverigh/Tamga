// Определение поворота страницы — независимый модуль, тот же паттерн, что
// classification.js/confidence.js: своя инструкция + свой кусок схемы ответа.
// Не участвует в извлечении полей и НЕ списывает лимит страниц (см.
// api/detect-orientation.js) — это дешёвая проверка перед основным платным
// запросом распознавания, а не само распознавание документа.
//
// Ethan, 19 сен 2026: старые сканы/фото документов (например, свидетельства
// о рождении) иногда сфотографированы/отсканированы боком — текст читается,
// только если повернуть картинку на 90/180/270°. Отправленный "как есть"
// повёрнутый скан Gemini распознаёт нестабильно (разный результат от запроса
// к запросу даже при temperature:0, см. geminiClient.js) — модели вообще
// заметно хуже и менее предсказуемо читают текст не в обычной ориентации.
// Пикселей это не чинит само по себе — реальная коррекция (поворот canvas)
// происходит на клиенте, см. public/js/ocr/orientation.js.
function buildOrientationInstruction() {
  return 'Determine how many degrees this image must be rotated CLOCKWISE ' +
    'so that its text becomes upright and reads normally left-to-right, ' +
    'top-to-bottom. Answer with exactly one of: 0, 90, 180, 270.';
}

function orientationSchemaField() {
  return { rotation: { type: 'INTEGER' } };
}

// Модель иногда отвечает не строго кратным 90 значением — округляем до
// ближайшего допустимого угла вместо того, чтобы падать или игнорировать
// результат целиком (тот же принцип, что normalizeConfidence в fieldFormat.js).
function normalizeRotation(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return (((Math.round(n / 90) * 90) % 360) + 360) % 360;
}

module.exports = { buildOrientationInstruction, orientationSchemaField, normalizeRotation };
