// Пайплайн бухгалтерских документов — классификация + извлечение в ОДНОМ
// вызове Gemini (тот же приём экономии, что в lib/recognize.js), затем
// нормализация и правила. Не импортирует lib/recognize.js и не расширяет
// его — отдельный, параллельный пайплайн (см. lib/accounting/docSchema.js,
// комментарий про "оригинальный код не менять").
//
// Обобщено 14 сен 2026 при добавлении 'nakladnaya' (Товарная накладная) —
// раньше здесь была одна функция recognizeEsf, жёстко завязанная на ЭСФ.
// TYPE_REGISTRY ниже — то единственное место, которое нужно расширить при
// добавлении следующего Phase-4-типа (акт/платёжное поручение/чек).
//
// ВАЖНО про schema: и ЭСФ, и накладная используют одно и то же свойство
// "items" в JSON-схеме ответа Gemini (Gemini Structured Output не поддерживает
// два разных массива "items" под одним типом при классификации ОДНИМ
// вызовом). Поэтому все типы делят один и тот же ESF_ITEM_SCHEMA — накладная
// просто не использует vat_rate/vat_amount построчно (см. extraction.js).
// Header-поля НЕ пересекаются по значению (invoice_number vs
// delivery_note_number и т.п.), кроме buyer_name/buyer_inn/subtotal/
// vat_total/total/currency — те у всех типов означают одно и то же, поэтому
// объединяются без переименования.

const { buildClassificationInstruction, classificationSchemaField } = require('./classification');
const {
  buildEsfExtractionInstruction, esfSchemaProperties, ESF_HEADER_FIELDS,
  buildNakladnayaExtractionInstruction, nakladnayaSchemaProperties, NAKLADNAYA_HEADER_FIELDS,
  buildActExtractionInstruction, actSchemaProperties, ACT_HEADER_FIELDS,
  buildPaymentOrderExtractionInstruction, paymentOrderSchemaProperties, PAYMENT_ORDER_HEADER_FIELDS
} = require('./extraction');
const { buildEsfDoc, buildNakladnayaDoc, buildActDoc, buildPaymentOrderDoc } = require('./document');
const { ESF_RULES } = require('./rules/esf');
const { NAKLADNAYA_RULES } = require('./rules/nakladnaya');
const { ACT_RULES } = require('./rules/act');
const { PAYMENT_ORDER_RULES } = require('./rules/payment_order');
const { runRules, overallStatus } = require('./rules/engine');
const { callGemini, GeminiError } = require('../geminiClient');
// Добавлено 15 сен 2026 при открытии модуля бухгалтерии платным клиентам
// Tamga (Ethan: "общий лимит с обычным распознаванием") — импорт ИЗ
// бухгалтерского модуля кода общей системы клиентов/лимитов, чего раньше
// сознательно избегали (см. комментарий в шапке файла про "не импортирует
// lib/recognize.js"). Разрешено явно: 15 сен 2026 Ethan снял правило "не
// трогать код вне модуля" насовсем, и здесь ровно обратное направление —
// модуль читает общий lib/, не наоборот, так что recognizeDocument
// по-прежнему ничего не знает про бухгалтерию.
const { consumeUsage } = require('../customFieldsLookup');
const { recordUsageEvent } = require('../usageAnalytics');
const { recordDocumentTemplate } = require('../documentTemplates');

class AccountingError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

const TYPE_REGISTRY = {
  esf: {
    extractionInstruction: buildEsfExtractionInstruction,
    schemaProperties: esfSchemaProperties,
    headerFields: ESF_HEADER_FIELDS,
    buildDoc: buildEsfDoc,
    rules: ESF_RULES
  },
  nakladnaya: {
    extractionInstruction: buildNakladnayaExtractionInstruction,
    schemaProperties: nakladnayaSchemaProperties,
    headerFields: NAKLADNAYA_HEADER_FIELDS,
    buildDoc: buildNakladnayaDoc,
    rules: NAKLADNAYA_RULES
  },
  act: {
    extractionInstruction: buildActExtractionInstruction,
    schemaProperties: actSchemaProperties,
    headerFields: ACT_HEADER_FIELDS,
    buildDoc: buildActDoc,
    rules: ACT_RULES
  },
  payment_order: {
    extractionInstruction: buildPaymentOrderExtractionInstruction,
    schemaProperties: paymentOrderSchemaProperties,
    headerFields: PAYMENT_ORDER_HEADER_FIELDS,
    buildDoc: buildPaymentOrderDoc,
    rules: PAYMENT_ORDER_RULES
  }
};

function buildCombinedInstruction() {
  const perType = Object.values(TYPE_REGISTRY).map(t => t.extractionInstruction()).join(' ');
  return `${buildClassificationInstruction()} Once you have determined the document type, extract its fields as ` +
    `follows (only one of these will apply, based on your classification): ${perType} Only fill in fields relevant ` +
    'to the document type you actually determined — for fields belonging to a different document type, leave ' +
    'value as an empty string and confidence at 0.';
}

function buildCombinedSchema() {
  const properties = { ...classificationSchemaField() };
  for (const type of Object.values(TYPE_REGISTRY)) Object.assign(properties, type.schemaProperties());
  return properties;
}

// rawResult — parsed Gemini JSON: { doc_type, invoice_number: {...} | delivery_note_number: {...}, ..., items: [...] }.
// Splits it into the {header, items} shape document.js expects, using only
// the header field keys that belong to the detected docType.
function splitRawResult(rawResult, docType) {
  const header = {};
  for (const key of TYPE_REGISTRY[docType].headerFields) {
    if (rawResult[key]) header[key] = rawResult[key];
  }
  return { header, items: Array.isArray(rawResult.items) ? rawResult.items : [] };
}

// clientApiKey/clientSlug — НЕОБЯЗАТЕЛЬНЫЕ, добавлены 15 сен 2026 (Ethan:
// "модуль бухгалтерии для платных клиентов", "общий лимит с обычным
// распознаванием"). Ровно один из них может быть передан — тот же контракт,
// что у lib/recognize.js:recognizeDocument (clientApiKey — x-api-key внешней
// интеграции через /api/v1/accounting/recognize.js, clientSlug — клиент
// веб-панели через /api/accounting/client-recognize.js). Оба ОТСУТСТВУЮТ
// у уже существующих вызывающих (api/accounting/recognize.js с отдельным
// ACCOUNTING_API_KEYS-периметром и api/accounting/admin-recognize.js) — для
// них квота НЕ проверяется и НЕ списывается, поведение не меняется. Именно
// consumeUsage (та же RPC consume_page_usage, что и в lib/recognize.js) даёт
// "общий лимит с обычным распознаванием", а не отдельный счётчик — страница,
// списанная здесь, уменьшает тот же пакет page_limit/pages_used клиента.
async function recognizeAccountingDocument({ base64, mimeType, apiKey, clientApiKey, clientSlug }) {
  if (!base64 || typeof base64 !== 'string') throw new AccountingError('Поле "image" (base64) обязательно');
  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new AccountingError(`Поле "mimeType" должно быть одним из: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  // Списываем страницу ДО вызова Gemini (тот же приём, что в lib/recognize.js
  // — не тратить платный вызов модели на страницу, которую всё равно
  // заблокирует лимит).
  if (clientApiKey || clientSlug) {
    const usage = await consumeUsage({ apiKey: clientApiKey, clientSlug });
    if (usage.unavailable) throw new AccountingError('Учёт лимитов временно недоступен', 503, 'QUOTA_UNAVAILABLE');
    if (!usage.allowed) {
      throw new AccountingError(
        `Лимит страниц по вашему тарифу исчерпан (${usage.pagesUsed}/${usage.pageLimit}). Обратитесь к администратору для пополнения пакета.`,
        402,
        'QUOTA_EXCEEDED'
      );
    }
  }

  let response;
  try {
    const schemaProperties = buildCombinedSchema();
    response = await callGemini({
      apiKey,
      instruction: buildCombinedInstruction(),
      mimeType,
      base64,
      schemaProperties,
      // Require the complete envelope so Gemini cannot silently omit
      // document fields. Irrelevant fields are still returned empty as
      // instructed; splitRawResult keeps only fields for the detected type.
      requiredFields: Object.keys(schemaProperties)
    });
  } catch (err) {
    if (err instanceof GeminiError) throw new AccountingError(err.message, err.status);
    throw err;
  }

  const rawResult = response.result;
  if (rawResult.__unparsed) {
    throw new AccountingError('Gemini вернула ответ не по схеме — повторите запрос', 502);
  }
  const docType = rawResult.doc_type;
  const typeDef = TYPE_REGISTRY[docType];
  if (!typeDef) {
    throw new AccountingError(`Документ не распознан ни как один из поддерживаемых типов (определён тип: "${docType}")`, 422, 'wrong_doc_type');
  }

  const { header, items } = splitRawResult(rawResult, docType);
  const doc = typeDef.buildDoc({ header, items });
  const results = runRules(typeDef.rules, doc);
  const status = overallStatus(results);

  // Аналитика — тот же принцип, что safeRecordUsageEvent в lib/recognize.js:
  // fail-safe (никогда не должна ронять сам ответ), и только для платных
  // клиентов Tamga (clientApiKey/clientSlug) — попадает в тот же разрез
  // "По типам" в /admin, что и обычное распознавание, doc_type здесь один
  // из esf/nakladnaya/act/payment_order.
  const usageClientRef = clientApiKey || clientSlug || null;
  if (usageClientRef) {
    try {
      const outcome = await recordUsageEvent({
        clientRef: usageClientRef, docType, success: true, confidence: null,
        promptTokens: response.usage ? (response.usage.promptTokenCount ?? null) : null,
        outputTokens: response.usage ? (response.usage.candidatesTokenCount ?? null) : null,
        totalTokens: response.usage ? (response.usage.totalTokenCount ?? null) : null,
        latencyMs: null
      });
      if (!outcome.ok) console.error('accounting: analytics event rejected');
    } catch (err) {
      console.error('accounting: analytics unavailable —', err.message);
    }
  }

  // Собираем ту же обезличенную сигнатуру полей, что и обычное
  // распознавание. Это не подставляет данные из прошлых документов и пока
  // не меняет промпт Gemini, но позволяет бухгалтерским формам участвовать
  // в общей библиотеке повторяющихся шаблонов.
  if (usageClientRef) {
    try {
      const templateFields = Object.entries(doc.header || {}).map(([key, field]) => ({
        label: key,
        value: field && typeof field.value === 'string' ? field.value : ''
      })).filter(field => field.label);
      await recordDocumentTemplate({
        clientRef: usageClientRef,
        docType,
        fields: templateFields,
        confidence: null
      });
    } catch (err) {
      console.error('accounting: document template unavailable —', err.message);
    }
  }

  return {
    docType,
    header: doc.header,
    items: doc.items,
    normalized: doc.normalized,
    results,
    overallStatus: status,
    usage: response.usage
  };
}

module.exports = { recognizeAccountingDocument, AccountingError };
