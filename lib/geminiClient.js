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

function buildRequestBody({ instruction, mimeType, base64, schemaProperties, requiredFields }) {
  return {
    contents: [{
      parts: [
        { text: instruction },
        { inline_data: { mime_type: mimeType, data: base64 } }
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
async function callGemini({ apiKey, instruction, mimeType, base64, schemaProperties, requiredFields }) {
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY не настроен на сервере', 500);
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody({ instruction, mimeType, base64, schemaProperties, requiredFields }))
    }
  );

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (_) { /* ignore */ }
    // ВАЖНО: раньше здесь был захардкожен статус 502 независимо от того, что реально
    // вернула Gemini (429/503/500/...) — из-за этого клиентский retry в
    // geminiRecognizeClient.js, проверяющий res.status, никогда не видел настоящий
    // код и не срабатывал. Теперь пробрасываем res.status как есть.
    throw new GeminiError(`Gemini API вернул ошибку ${res.status}${detail ? ': ' + detail : ''}`, res.status);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (raw === undefined) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new GeminiError(blockReason ? `Gemini заблокировал документ (${blockReason})` : 'Gemini не вернул текст', 502);
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    // Модель иногда не укладывается в схему — возвращаем как есть, вызывающий код решит, что делать.
    return { __unparsed: raw };
  }
}

module.exports = { callGemini, GeminiError, GEMINI_MODEL };
