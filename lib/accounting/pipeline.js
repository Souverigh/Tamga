// Пайплайн ЭСФ — классификация + извлечение в ОДНОМ вызове Gemini (тот же
// приём экономии, что в lib/recognize.js), затем нормализация и правила.
// Не импортирует lib/recognize.js и не расширяет его — отдельный, параллельный
// пайплайн (см. lib/accounting/docSchema.js, комментарий про "оригинальный
// код не менять").

const { buildClassificationInstruction, classificationSchemaField } = require('./classification');
const { buildEsfExtractionInstruction, esfSchemaProperties, ESF_HEADER_FIELDS } = require('./extraction');
const { buildEsfDoc } = require('./document');
const { ESF_RULES } = require('./rules/esf');
const { runRules, overallStatus } = require('./rules/engine');
const { callGemini, GeminiError } = require('../geminiClient');

class AccountingError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

function buildCombinedInstruction() {
  return `${buildClassificationInstruction()} Then, assuming this document IS the expected type, ${buildEsfExtractionInstruction()}`;
}

function buildCombinedSchema() {
  return {
    ...classificationSchemaField(),
    ...esfSchemaProperties()
  };
}

// rawResult — parsed Gemini JSON: { doc_type, invoice_number: {...}, ..., items: [...] }.
// Splits it into the {header, items} shape document.js expects.
function splitRawResult(rawResult) {
  const header = {};
  for (const key of ESF_HEADER_FIELDS) {
    if (rawResult[key]) header[key] = rawResult[key];
  }
  return { header, items: Array.isArray(rawResult.items) ? rawResult.items : [] };
}

async function recognizeEsf({ base64, mimeType, apiKey }) {
  if (!base64 || typeof base64 !== 'string') throw new AccountingError('Поле "image" (base64) обязательно');
  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new AccountingError(`Поле "mimeType" должно быть одним из: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  let response;
  try {
    response = await callGemini({
      apiKey,
      instruction: buildCombinedInstruction(),
      mimeType,
      base64,
      schemaProperties: buildCombinedSchema(),
      requiredFields: ['doc_type']
    });
  } catch (err) {
    if (err instanceof GeminiError) throw new AccountingError(err.message, err.status);
    throw err;
  }

  const rawResult = response.result;
  if (rawResult.__unparsed) {
    throw new AccountingError('Gemini вернула ответ не по схеме — повторите запрос', 502);
  }
  if (rawResult.doc_type !== 'esf') {
    throw new AccountingError(`Документ не распознан как Счет-фактура/ЭСФ (определён тип: "${rawResult.doc_type}")`, 422, 'wrong_doc_type');
  }

  const { header, items } = splitRawResult(rawResult);
  const doc = buildEsfDoc({ header, items });
  const results = runRules(ESF_RULES, doc);
  const status = overallStatus(results);

  return {
    docType: 'esf',
    header: doc.header,
    items: doc.items,
    normalized: doc.normalized,
    results,
    overallStatus: status,
    usage: response.usage
  };
}

module.exports = { recognizeEsf, AccountingError };
