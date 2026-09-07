// Самооценка уверенности модели — независимый модуль, по тому же паттерну,
// что ocr.js/classification.js: своя инструкция + свой кусок схемы ответа,
// не знает ни про тип документа, ни про извлечение полей.
//
// Ethan: клиенту на своей стороне нужно понимать, какой документ из пачки
// стоит перепроверить руками, не открывая каждый по очереди. Единственный
// сигнал, который реально доступен без второй модели/эвристики — попросить
// саму Gemini оценить, насколько она уверена в своём же результате.
//
// ВАЖНО: это self-reported confidence (модель сама себя оценивает в том же
// ответе), а НЕ статистическая вероятность — Gemini API не отдаёт log-probs
// для structured output, отдельного "настоящего" числа взять неоткуда. Сигнал
// всё равно полезный на практике (заметно ниже на нечётких/обрезанных/некачественных
// сканах), но не идеально откалиброван — поэтому на фронтенде (см. ui/results.js)
// это подаётся клиенту как рекомендация "стоит перепроверить", а не как гарантию
// правильности/ошибки.
function buildConfidenceInstruction() {
  return 'Also rate your own confidence that the text, fields and values you extracted from this image ' +
    'are complete and correct, as an integer from 0 to 100. Lower the score for: blurry, low-resolution, ' +
    'poorly lit, or partially cut-off images; illegible or ambiguous handwriting or print; watermarks, ' +
    'glare, folds, stains or other damage covering parts of the text; any value you had to guess rather ' +
    'than read directly. Use the full range — a clear, well-lit, fully legible document should score above ' +
    '90; a document where you had to guess several values should score well below 50.';
}

function confidenceSchemaField() {
  return { confidence: { type: 'INTEGER' } };
}

module.exports = { buildConfidenceInstruction, confidenceSchemaField };
