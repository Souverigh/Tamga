const { DOC_TYPES, DOC_FIELDS } = require('./docSchema');

const GEMINI_MODEL = 'gemini-3.6-flash';
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
// Ограничение на размер входящего файла (декодированного base64), в байтах.
// Держим консервативно ниже жёсткого лимита тела запроса serverless-функций Vercel (~4.5MB на Hobby).
const MAX_INPUT_BYTES = 4 * 1024 * 1024;

class RecognizeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function estimateBase64Bytes(base64) {
  return Math.floor((base64.length * 3) / 4);
}

function buildPrompt() {
  return `Extract all text from this document exactly as written, preserving line breaks and layout. The document may mix Kyrgyz and Russian text — transcribe each accurately in its own script, including Kyrgyz-specific letters (Ң, Ө, Ү). Classify the document into exactly one of these categories: ${DOC_TYPES.join(', ')}. Then, based on the detected category, extract structured fields as label/value pairs. Use EXACTLY the Russian field labels for that category from this mapping (leave value as an empty string if not present in the document): ${JSON.stringify(DOC_FIELDS)}. Respond only with a JSON object matching the schema — no commentary or markdown formatting.`;
}

function buildRequestBody(mimeType, base64) {
  return {
    contents: [{
      parts: [
        { text: buildPrompt() },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          documentType: { type: 'STRING', enum: DOC_TYPES },
          text: { type: 'STRING' },
          fields: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                label: { type: 'STRING' },
                value: { type: 'STRING' }
              },
              required: ['label', 'value']
            }
          }
        },
        required: ['documentType', 'text', 'fields']
      }
    }
  };
}

// Основная функция распознавания. Ключ Gemini берётся только из переменной
// окружения на сервере — никогда не передаётся и не логируется как параметр.
async function recognizeDocument({ base64, mimeType }) {
  if (!base64 || typeof base64 !== 'string') {
    throw new RecognizeError('Поле "image" (base64) обязательно');
  }
  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new RecognizeError(`Поле "mimeType" должно быть одним из: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }
  if (estimateBase64Bytes(base64) > MAX_INPUT_BYTES) {
    throw new RecognizeError('Файл слишком большой для одного запроса (лимит ~4MB на страницу/изображение)', 413);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new RecognizeError('GEMINI_API_KEY не настроен на сервере', 500);
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody(mimeType, base64))
    }
  );

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (_) { /* ignore */ }
    throw new RecognizeError(`Gemini API вернул ошибку ${res.status}${detail ? ': ' + detail : ''}`, 502);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (raw === undefined) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new RecognizeError(blockReason ? `Gemini заблокировал документ (${blockReason})` : 'Gemini не вернул текст', 502);
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      text: (parsed.text || '').trim(),
      documentType: parsed.documentType || 'Другое',
      fields: Array.isArray(parsed.fields) && parsed.fields.length ? parsed.fields : []
    };
  } catch (e) {
    return { text: raw.trim(), documentType: 'Другое', fields: [] };
  }
}

module.exports = { recognizeDocument, RecognizeError, ALLOWED_MIME_TYPES };
