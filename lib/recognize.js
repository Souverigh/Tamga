// Оркестратор распознавания документа.
//
// Собирает вместе три независимых модуля — ocr.js (текст), classification.js
// (тип документа) и extraction.js (поля) — в один запрос к Gemini ради
// экономии (один вызов вместо трёх). Модули ничего не знают друг о друге:
// эта функция единственная, кто их соединяет.
//
// Если docType передан заранее (пользователь выбрал тип вручную в интерфейсе) —
// классификация пропускается целиком: не добавляется ни в промпт, ни в схему
// ответа. Извлечение полей в этом случае идёт сразу под известный тип —
// короче промпт и точнее результат.

const { buildOcrInstruction, ocrSchemaField } = require('./ocr');
const { buildClassificationInstruction, classificationSchemaField, isValidDocType } = require('./classification');
const { buildExtractionInstruction, extractionSchemaField, itemsSchemaField } = require('./extraction');
const { isTableType } = require('./docSchema');
const { callGemini, GeminiError } = require('./geminiClient');

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

function validateInput({ base64, mimeType }) {
  if (!base64 || typeof base64 !== 'string') {
    throw new RecognizeError('Поле "image" (base64) обязательно');
  }
  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new RecognizeError(`Поле "mimeType" должно быть одним из: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }
  if (estimateBase64Bytes(base64) > MAX_INPUT_BYTES) {
    throw new RecognizeError('Файл слишком большой для одного запроса (лимит ~4MB на страницу/изображение)', 413);
  }
}

// Собирает промпт и схему ответа из независимых модулей.
// knownDocType — опциональный тип документа, если он уже известен (пропускает классификацию).
function buildInstructionAndSchema(knownDocType) {
  const skipClassification = knownDocType && isValidDocType(knownDocType);
  // Табличные типы (накладная/УПД) сейчас поддерживаются только когда тип
  // известен заранее (пользователь выбрал вручную) — см. комментарий в
  // extraction.js про buildExtractionInstruction. При неизвестном типе схема
  // всегда описывает fields (label/value), даже если Gemini классифицирует
  // документ как накладную — тогда fields придут пустыми (см. recognizeDocument).
  const tableMode = skipClassification && isTableType(knownDocType);

  const instructionParts = [buildOcrInstruction()];
  if (!skipClassification) instructionParts.push(buildClassificationInstruction());
  instructionParts.push(buildExtractionInstruction(knownDocType));

  const schemaProperties = {
    ...ocrSchemaField(),
    ...(skipClassification ? {} : classificationSchemaField()),
    ...(tableMode ? itemsSchemaField() : extractionSchemaField())
  };
  const requiredFields = [
    'text',
    tableMode ? 'items' : 'fields',
    ...(skipClassification ? [] : ['documentType'])
  ];

  return { instruction: instructionParts.join(' '), schemaProperties, requiredFields, skipClassification, tableMode };
}

// Основная функция распознавания. Ключ Gemini берётся только из переменной
// окружения на сервере — никогда не передаётся и не логируется как параметр.
// docType — необязательный: если передан, классификация не выполняется вообще.
async function recognizeDocument({ base64, mimeType, docType }) {
  validateInput({ base64, mimeType });

  const apiKey = process.env.GEMINI_API_KEY;
  const { instruction, schemaProperties, requiredFields, skipClassification, tableMode } = buildInstructionAndSchema(docType);

  let parsed;
  try {
    parsed = await callGemini({ apiKey, instruction, mimeType, base64, schemaProperties, requiredFields });
  } catch (err) {
    if (err instanceof GeminiError) throw new RecognizeError(err.message, err.status);
    throw err;
  }

  if (parsed.__unparsed !== undefined) {
    return { text: parsed.__unparsed.trim(), documentType: docType || 'Другое', fields: [], items: [] };
  }

  return {
    text: (parsed.text || '').trim(),
    documentType: skipClassification ? docType : (parsed.documentType || 'Другое'),
    fields: !tableMode && Array.isArray(parsed.fields) && parsed.fields.length ? parsed.fields : [],
    items: tableMode && Array.isArray(parsed.items) && parsed.items.length ? parsed.items : []
  };
}

module.exports = { recognizeDocument, RecognizeError, ALLOWED_MIME_TYPES };
