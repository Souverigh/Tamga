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
// к запросу даже при temperature:0, см. geminiClient.js).
//
// ВАЖНО (второй заход после первой версии этого модуля): просить модель
// НАЗВАТЬ УГОЛ ЧИСЛОМ ("на сколько градусов повёрнуто") — абстрактная
// пространственная задача, в которой vision-модели сами по себе нестабильны
// (в этом и была причина того, что автоповорот не спас положение с первого
// раза). Вместо этого показываем ей ЧЕТЫРЕ готовых варианта картинки — по
// одному на каждый возможный поворот — и просим просто ВЫБРАТЬ, какой из
// них уже читается правильно. Это задача на сравнение/различение, а не на
// вычисление угла, и с ней модели справляются значительно надёжнее.
const ROTATIONS = [0, 90, 180, 270];

function buildOrientationInstruction() {
  return 'You are shown the same scanned document page 4 times, each rotated differently. ' +
    'Image 1 = rotated 0°, Image 2 = rotated 90° clockwise, Image 3 = rotated 180°, ' +
    'Image 4 = rotated 270° clockwise, relative to the original file. ' +
    'Exactly one of the four shows the page upright, with text reading normally ' +
    'left-to-right and top-to-bottom. Identify which image number that is.';
}

function orientationSchemaField() {
  return { uprightImage: { type: 'STRING', enum: ['1', '2', '3', '4'] } };
}

// Модель иногда отвечает вне ожидаемого набора значений — тогда безопаснее
// считать "уже прямая" (0), чем поворачивать наугад.
function rotationForUprightImage(value) {
  const index = ['1', '2', '3', '4'].indexOf(String(value));
  return index === -1 ? 0 : ROTATIONS[index];
}

module.exports = { ROTATIONS, buildOrientationInstruction, orientationSchemaField, rotationForUprightImage };
