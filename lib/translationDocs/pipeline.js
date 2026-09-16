// Пайплайн модуля "Перевод" (Ethan, 16 сен 2026: "то же самое для перевода
// — отдельная загрузка, как бухгалтерия; общий лимит страниц с
// распознаванием; плюс апостиль и другие типы документов" — уточнено через
// AskUserQuestion: перевод переезжает из "перевести уже распознанные поля
// внутри обычного потока" в свой собственный загрузочный поток, по образцу
// lib/accounting/pipeline.js).
//
// TYPE_REGISTRY — единственное место, которое нужно расширить для
// следующего типа документа для перевода (диплом, свидетельство о браке,
// нотариальная доверенность и т.п.) — тот же приём, что у
// lib/accounting/pipeline.js: classification+extraction в ОДНОМ вызове
// Gemini, "подтвердите тип" вместо выбора из списка, пока тип всего один.
//
// ОТЛИЧИЕ от бухгалтерии: после извлечения полей документ ЕЩЁ переводится —
// вторым вызовом Gemini через lib/translation.js:translateSegments (та же
// функция и та же гарантия "перевод не меняет числа/суммы", что раньше
// использовал public/js/translation/panel.js). Квота (consumeUsage,
// consume_page_usage) списывается ОДИН раз за весь документ — до первого
// вызова Gemini, как у recognize.js/accounting; сам перевод (второй вызов)
// квоту НЕ списывает повторно — один загруженный документ = одна страница
// пакета клиента, независимо от того, что внутри два обращения к модели.
//
// lib/translationQuota.js (отдельный дневной/месячный счётчик запросов,
// который использовал старый api/translate.js) сюда сознательно НЕ
// импортируется — Ethan, 16 сен 2026, явно попросил общий лимит страниц
// вместо отдельной квоты. api/translate.js и его квота остаются в
// кодовой базе как есть (используются старым lib/translation/panel.js,
// который сейчас никуда не подключён), но новый путь их не использует.

const { APOSTILLE_FIELDS, apostilleSchemaProperties, buildApostilleExtractionInstruction } = require('./apostille');
const { callGemini, GeminiError } = require('../geminiClient');
const { consumeUsage } = require('../customFieldsLookup');
const { recordUsageEvent } = require('../usageAnalytics');
const { validateTranslationRequest, translateSegments } = require('../translation');

class TranslationDocError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

const TYPE_REGISTRY = {
  apostille: {
    label: 'Апостиль',
    hint: 'an apostille (a Hague Convention 1961 certificate authenticating a public document — a numbered ' +
      'stamp/page headed "Apostille"/"Апостиль")',
    fields: APOSTILLE_FIELDS,
    schemaProperties: apostilleSchemaProperties,
    extractionInstruction: buildApostilleExtractionInstruction
  }
};

function buildClassificationInstruction() {
  const types = Object.keys(TYPE_REGISTRY);
  if (types.length === 1) {
    const only = TYPE_REGISTRY[types[0]];
    return `Confirm whether this document is: ${only.hint}. If it matches, set doc_type to "${types[0]}". If the ` +
      'document clearly does not match this description, set doc_type to "unknown".';
  }
  const lines = types.map(key => `- "${key}": ${TYPE_REGISTRY[key].hint}`).join('\n');
  return `Classify this document into exactly one of the following categories:\n${lines}\nIf none clearly match, set doc_type to "unknown".`;
}

function buildCombinedInstruction() {
  const perType = Object.values(TYPE_REGISTRY).map(t => t.extractionInstruction()).join(' ');
  return `${buildClassificationInstruction()} Once you have determined the document type, extract its fields as ` +
    `follows (only one of these will apply, based on your classification): ${perType} Only fill in fields relevant ` +
    'to the document type you actually determined — for fields belonging to a different document type, leave value ' +
    'as an empty string and confidence at 0.';
}

function buildCombinedSchema() {
  const properties = { doc_type: { type: 'STRING' } };
  for (const type of Object.values(TYPE_REGISTRY)) Object.assign(properties, type.schemaProperties());
  return properties;
}

// clientApiKey/clientSlug — ровно один может быть передан, тот же контракт,
// что у lib/accounting/pipeline.js:recognizeAccountingDocument
// (clientApiKey — x-api-key внешней интеграции через
// api/v1/translation-docs/recognize.js, clientSlug — клиент веб-панели
// через api/translation-docs/client-recognize.js). Оба ОТСУТСТВУЮТ, если
// вызывающий код их не передал — тогда квота НЕ проверяется (используется
// только внутренними тестами/скриптами, не публичными эндпоинтами).
async function recognizeAndTranslateDocument({ base64, mimeType, apiKey, language, clientApiKey, clientSlug }) {
  if (!base64 || typeof base64 !== 'string') throw new TranslationDocError('Поле "image" (base64) обязательно');
  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new TranslationDocError(`Поле "mimeType" должно быть одним из: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }
  if (!language || typeof language !== 'string') {
    throw new TranslationDocError('Поле "language" (язык перевода) обязательно');
  }

  // Списываем страницу ДО вызова Gemini (тот же приём, что в
  // lib/recognize.js и lib/accounting/pipeline.js) — не тратить платный
  // вызов модели на страницу, которую всё равно заблокирует лимит.
  if (clientApiKey || clientSlug) {
    const usage = await consumeUsage({ apiKey: clientApiKey, clientSlug });
    if (usage.unavailable) throw new TranslationDocError('Учёт лимитов временно недоступен', 503, 'QUOTA_UNAVAILABLE');
    if (!usage.allowed) {
      throw new TranslationDocError(
        `Лимит страниц по вашему тарифу исчерпан (${usage.pagesUsed}/${usage.pageLimit}). Обратитесь к администратору для пополнения пакета.`,
        402,
        'QUOTA_EXCEEDED'
      );
    }
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
    if (err instanceof GeminiError) throw new TranslationDocError(err.message, err.status);
    throw err;
  }

  const rawResult = response.result;
  if (rawResult.__unparsed) {
    throw new TranslationDocError('Gemini вернула ответ не по схеме — повторите запрос', 502);
  }
  const docType = rawResult.doc_type;
  const typeDef = TYPE_REGISTRY[docType];
  if (!typeDef) {
    throw new TranslationDocError(
      `Документ не распознан ни как один из поддерживаемых для перевода типов (определён тип: "${docType}")`,
      422,
      'wrong_doc_type'
    );
  }

  const usageClientRef = clientApiKey || clientSlug || null;

  // Собираем сегменты для перевода — только непустые значения (translateSegments
  // отклоняет пустой текст сегмента).
  const fieldsByKey = {};
  const segments = [];
  for (const { key, label } of typeDef.fields) {
    const raw = rawResult[key] || {};
    const value = typeof raw.value === 'string' ? raw.value : '';
    fieldsByKey[key] = {
      key,
      label,
      value,
      rawText: typeof raw.raw_text === 'string' ? raw.raw_text : '',
      confidence: Number.isFinite(raw.confidence) ? raw.confidence : 0,
      translated: ''
    };
    if (value.trim()) segments.push({ id: key, text: value });
  }

  if (segments.length) {
    const request = validateTranslationRequest({ language, segments });
    const { segments: translated } = await translateSegments(request, usageClientRef);
    for (const seg of translated) {
      if (fieldsByKey[seg.id]) fieldsByKey[seg.id].translated = seg.text;
    }
  }

  // Аналитика — тот же fail-safe принцип, что у lib/accounting/pipeline.js
  // (никогда не должна ронять сам ответ), только для платных клиентов Tamga.
  // docType здесь — конкретный тип документа ("apostille" и далее), не общий
  // "Перевод" — попадает в тот же разрез "По типам" в /admin, что и обычное
  // распознавание/бухгалтерия, отдельной строкой на каждый тип.
  if (usageClientRef) {
    try {
      const outcome = await recordUsageEvent({
        clientRef: usageClientRef, docType, success: true, confidence: null,
        promptTokens: response.usage ? (response.usage.promptTokenCount ?? null) : null,
        outputTokens: response.usage ? (response.usage.candidatesTokenCount ?? null) : null,
        totalTokens: response.usage ? (response.usage.totalTokenCount ?? null) : null,
        latencyMs: null
      });
      if (!outcome.ok) console.error('translationDocs: analytics event rejected');
    } catch (err) {
      console.error('translationDocs: analytics unavailable —', err.message);
    }
  }

  return {
    docType,
    language,
    fields: typeDef.fields.map(({ key }) => fieldsByKey[key]),
    usage: response.usage
  };
}

module.exports = { recognizeAndTranslateDocument, TranslationDocError, TYPE_REGISTRY };
