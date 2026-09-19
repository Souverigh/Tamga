const { reserveGeminiBudget } = require('./geminiBudget');
// Низкоуровневый клиент Gemini API.
// Ничего не знает про OCR/классификацию/извлечение полей — только берёт
// готовую инструкцию + схему ответа, отправляет запрос и возвращает
// распарсенный JSON. Вся доменная логика (что спросить у модели) живёт
// в ocr.js / classification.js / extraction.js и собирается в recognize.js.

const GEMINI_MODEL = 'gemini-3.6-flash';

class GeminiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// images (опционально) — несколько картинок в ОДНОМ запросе вместо одной
// mimeType/base64 (см. lib/orientation.js: сравнение 4 вариантов поворота
// страницы в одном вызове надёжнее, чем просьба назвать угол числом —
// vision-модели заметно хуже и менее стабильно решают абстрактную
// пространственную задачу "на сколько градусов повёрнуто", чем задачу на
// сравнение "какой из этих явно показанных вариантов читается правильно").
// Каждой картинке предшествует свой текстовый label (см. items ниже) —
// без него модель не может сослаться на конкретный вариант по номеру.
function buildRequestBody({ instruction, mimeType, base64, images, schemaProperties, requiredFields, sourceText }) {
  const imageParts = images
    ? images.flatMap(img => [{ text: img.label }, { inline_data: { mime_type: img.mimeType, data: img.base64 } }])
    : [{ inline_data: { mime_type: mimeType, data: base64 } }];
  return {
    ...(sourceText !== undefined ? { systemInstruction: { parts: [{ text: instruction }] } } : {}),
    contents: [{
      parts: sourceText !== undefined ? [{ text: sourceText }] : [
        { text: instruction },
        ...imageParts
      ]
    }],
    generationConfig: {
      // temperature: 0 — извлечение структурированных данных должно быть
      // максимально детерминированным, а не творческим; без явного значения
      // использовался бы дефолт модели, добавляющий ненужную вариативность
      // одного и того же документа между запусками.
      temperature: 0,
      // Достаточный запас на случай длинного документа (много текста + много
      // строк таблицы в одном ответе) — без явного лимита используется дефолт
      // модели, и есть шанс словить обрезанный/невалидный JSON на крупной
      // накладной или справочнике (callGemini в этом случае отдаст __unparsed,
      // не упадёт, но данные не придут).
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: schemaProperties,
        required: requiredFields
      }
    }
  };
}

// Отправляет один запрос в Gemini и возвращает уже распарсенный объект ответа.
// apiKey передаётся явно (не читает env сам) — вызывающий код решает, откуда его брать.
async function callGemini({ apiKey, instruction, mimeType, base64, images, schemaProperties, requiredFields, sourceText }) {
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY не настроен на сервере', 500);
  }

  try { await reserveGeminiBudget({ mimeType, instruction: instruction + (sourceText || ''), imageCount: images?.length }); } catch (error) { throw new GeminiError(error.message, error.status || 503); }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify(buildRequestBody({ instruction, mimeType, base64, images, schemaProperties, requiredFields, sourceText }))
    }
  );

  if (!res.ok) {
    // ВАЖНО: раньше здесь был захардкожен статус 502 независимо от того, что реально
    // вернула Gemini (429/503/500/...) — из-за этого клиентский retry в
    // geminiRecognizeClient.js, проверяющий res.status, никогда не видел настоящий
    // код и не срабатывал. Теперь пробрасываем res.status как есть.
    throw new GeminiError(`Gemini API вернул ошибку ${res.status}`, res.status);
  }

  const data = await res.json();
  if (sourceText !== undefined && data?.candidates?.[0]?.finishReason !== 'STOP') {
    throw new GeminiError('Перевод не завершён. Повторите этот фрагмент.', 502);
  }
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  // usageMetadata — реальный расход токенов на этот вызов (Gemini считает и
  // отдаёт сама, никаких оценок с нашей стороны). Может отсутствовать, если
  // Gemini его почему-то не прислала — вызывающий код (recognize.js) должен
  // быть готов к null, а не падать. Используется только для логирования
  // (usageLogging.js) — на сам результат распознавания никак не влияет.
  const usage = data?.usageMetadata || null;
  if (raw === undefined) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new GeminiError(blockReason ? `Gemini заблокировал документ (${blockReason})` : 'Gemini не вернул текст', 502);
  }

  try {
    return { result: JSON.parse(raw), usage };
  } catch (e) {
    // Модель иногда не укладывается в схему — возвращаем как есть, вызывающий код решит, что делать.
    return { result: { __unparsed: raw }, usage };
  }
}

module.exports = { callGemini, GeminiError, GEMINI_MODEL };
