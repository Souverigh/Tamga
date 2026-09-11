// Распознавание: автоматическая классификация, затем извлечение.
// При известном типе выполняется только извлечение.

const { buildOcrInstruction, ocrSchemaField } = require('./ocr');
const { buildClassificationInstruction, classificationSchemaField, isValidDocType } = require('./classification');
const { buildExtractionInstruction, extractionSchemaField, itemsSchemaField, resolveTableColumns } = require('./extraction');
const { buildConfidenceInstruction, confidenceSchemaField } = require('./confidence');
const { isTableType, totalsForType } = require('./docSchema');
const { normalizeFields, normalizeItems, normalizeConfidence } = require('./fieldFormat');
const { callGemini, GeminiError } = require('./geminiClient');
const { getClientConfig, consumeUsage } = require('./customFieldsLookup');
const { consumeAnonymousUsage } = require('./anonymousUsage');
const { logRecognition, logRecognitionError } = require('./usageLogging');
const { recordBatchDocument } = require('./webhookBatches');
const { recordUsageEvent } = require('./usageAnalytics');
const { checkBusinessRules } = require('./postprocess/businessRules');

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
// Ограничение на размер входящего файла (декодированного base64), в байтах.
// Держим консервативно ниже жёсткого лимита тела запроса serverless-функций Vercel (~4.5MB на Hobby).
const MAX_INPUT_BYTES = 4 * 1024 * 1024;

class RecognizeError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
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

// Тип уже проверен или определён отдельным запросом классификации.
function buildInstructionAndSchema(knownDocType, { includeText = true, customFields = null, customDocTypes = null, formatting = null, fieldOverrides = null } = {}) {
  const tableMode = isTableType(knownDocType);
  const tableColumns = tableMode ? resolveTableColumns(knownDocType, fieldOverrides) : null;
  const totalsList = tableMode ? totalsForType(knownDocType) : null;
  const hasTotals = !!totalsList;
  const omitText = !includeText;
  const needsFields = !tableMode || hasTotals;
  const instructionParts = [];
  if (!omitText) instructionParts.push(buildOcrInstruction());
  instructionParts.push(buildExtractionInstruction(knownDocType, { customFields, customDocTypes, formatting, fieldOverrides }));
  instructionParts.push(buildConfidenceInstruction());
  const schemaProperties = {
    ...(omitText ? {} : ocrSchemaField()),
    ...(tableMode ? itemsSchemaField(knownDocType, fieldOverrides) : {}),
    ...(needsFields ? extractionSchemaField(hasTotals ? totalsList.length : null) : {}),
    ...confidenceSchemaField()
  };
  const requiredFields = [
    ...(omitText ? [] : ['text']),
    ...(tableMode ? ['items'] : []),
    ...(needsFields ? ['fields'] : []),
    'confidence'
  ];
  return { instruction: instructionParts.join(' '), schemaProperties, requiredFields, tableMode, tableColumns, hasTotals, omitText };
}

// Основная функция распознавания. Ключ Gemini берётся только из переменной
// окружения на сервере — никогда не передаётся и не логируется как параметр.
// docType — необязательный: если передан, классификация не выполняется вообще.
// includeText — необязательный (по умолчанию true): false, если вызывающему
// не нужен текст документа целиком в ответе (см. buildInstructionAndSchema).
// skipOcr здесь НЕ параметр — это внутренний, невидимый снаружи механизм
// (см. дозапрос за таблицей ниже и комментарий "закрыть дыру с skipOcr").
// clientApiKey — НЕ ключ Gemini (тот ниже, из env): это x-api-key бизнеса-интеграции
// (см. api/v1/recognize.js). clientSlug — идентификатор клиента в веб-интерфейсе
// (см. api/recognize.js, ?client=acme). Ровно один из них (или ни одного) может
// быть передан — оба используются только чтобы найти конфиг клиента в Supabase
// (см. customFieldsLookup.js: кастомные поля, кастомные типы документов,
// форматирование). Без них — поведение по умолчанию не меняется ни для кого.
// clientIp — IP анонимного посетителя (только для веб-эндпоинта без
// client_slug, см. api/recognize.js:extractClientIp) — нужен только чтобы
// применить дневной лимит бесплатного сайта (lib/anonymousUsage.js). Публичный
// API (api/v1/recognize.js) его никогда не передаёт — там всегда есть
// clientApiKey (иначе checkApiKey не пропустил бы запрос раньше).
// batchId — необязательный: если публичный API (api/v1/recognize.js) прислал
// batchId (см. api/v1/batch.js), после вызова Gemini документ атомарно
// засчитывается в этот пакет (lib/webhookBatches.js). Полностью fail-open:
// проблема с трекингом пакета (Supabase недоступен, чужой batchId, пакет уже
// закрыт) логируется, но НИКОГДА не влияет на сам ответ распознавания.
async function safeRecordBatchDocument({ batchId, apiKey, docType, success }) {
  if (!batchId) return;
  try {
    const outcome = await recordBatchDocument({ batchId, apiKey, docType, success });
    if (!outcome.ok) {
      console.error('recognize: документ не засчитан в пакет', batchId, '—', outcome.reason);
    }
  } catch (err) {
    console.error('recognize: ошибка трекинга пакета', batchId, '—', err.message);
  }
}

// Аналитика по клиенту (lib/usageAnalytics.js, см. её комментарий про область
// и client_ref). clientRef — apiKey либо clientSlug, ровно один из них может
// быть передан в recognizeDocument (см. её комментарий выше). Вызывается
// БЕЗУСЛОВНО, ровно один раз на вызов recognizeDocument (Ethan, 9 сен 2026,
// "закрыть дыру с skipOcr") — внутренний дозапрос за таблицей (см. ниже) не
// создаёт для этой функции отдельного вызова, он целиком внутри той же
// recognizeDocument и не должен задваивать "документов обработано" в
// дашборде клиента — раньше это обеспечивалось условием "!skipOcr", сейчас
// условие не нужно вообще, оно и так вызывается один раз на функцию.
async function safeRecordUsageEvent({ clientRef, docType, success, confidence, usage, latencyMs }) {
  if (!clientRef) return;
  try {
    const outcome = await recordUsageEvent({
      clientRef, docType, success, confidence,
      promptTokens: usage ? (usage.promptTokenCount ?? null) : null,
      outputTokens: usage ? (usage.candidatesTokenCount ?? null) : null,
      totalTokens: usage ? (usage.totalTokenCount ?? null) : null,
      latencyMs
    });
    if (!outcome.ok) {
      console.error('recognize: событие не записано в аналитику для', clientRef, '—', outcome.reason);
    }
  } catch (err) {
    console.error('recognize: ошибка записи аналитики для', clientRef, '—', err.message);
  }
}

// Aggregate both stages; absent metadata must not look like a complete total.
function combineUsage(first, second) {
  if (!first || !second) return null;
  return Object.fromEntries(['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'].map(key => [
    key, Number.isFinite(first[key]) && Number.isFinite(second[key]) ? first[key] + second[key] : null
  ]));
}

async function recognizeDocument({ base64, mimeType, docType, includeText, clientApiKey, clientSlug, clientIp, batchId }) {
  validateInput({ base64, mimeType });

  // Идентификатор клиента для аналитики (lib/usageAnalytics.js) — ровно один
  // из clientApiKey/clientSlug задан на вызов (см. комментарий выше про их
  // назначение), поэтому конфликта имён между каналами здесь не возникает.
  const usageClientRef = clientApiKey || clientSlug || null;

  // Разовый пакет страниц (page_limit/pages_used, см. миграцию
  // tamga_add_page_usage_limit) — проверяем и сразу инкрементируем ДО вызова
  // Gemini (не после), чтобы не тратить платный вызов модели на страницу,
  // которая всё равно будет заблокирована лимитом.
  //
  // Ethan, 9 сен 2026 ("закрыть дыру с skipOcr"): раньше здесь стояла
  // проверка "if (!skipOcr)" — skipOcr был параметром, который принимался
  // ИЗВНЕ (из тела запроса и в /api/recognize, и в публичном /api/v1/recognize),
  // и одновременно означал "не списывать страницу". Это было нужно только для
  // служебного дозапроса за таблицей (табличный тип определился только по
  // результату классификации, поэтому первый запрос его не мог сразу
  // запросить, см. buildInstructionAndSchema) — тот же документ, та же
  // страница, просто Gemini физически нужно спросить дважды. НО раз параметр
  // был доступен снаружи — ЛЮБОЙ вызывающий (не только наш собственный клиент)
  // мог передать skipOcr:true напрямую и получить страницу бесплатно, минуя
  // лимит. Публичный репозиторий на GitHub — значит и это поведение читаемо
  // кем угодно, не только теоретический риск.
  //
  // Решение — дозапрос за таблицей теперь ПОЛНОСТЬЮ ВНУТРИ этой функции (см.
  // ниже, после основного запроса), а не отдельным HTTP-вызовом с клиента.
  // Наружу skipOcr вообще не принимается больше — эта функция теперь ВСЕГДА
  // соответствует ровно одной странице с точки зрения вызывающего, поэтому
  // подсчёт страницы происходит безусловно, один раз, без всякого "if".
  if (clientApiKey || clientSlug) {
    const usage = await consumeUsage({ apiKey: clientApiKey, clientSlug });
    if (!usage.allowed) {
      throw new RecognizeError(
        `Лимит страниц по вашему тарифу исчерпан (${usage.pagesUsed}/${usage.pageLimit}). Обратитесь к администратору для пополнения пакета.`,
        402
      );
    }
  } else if (clientIp) {
    // Анонимный посетитель бесплатного сайта — дневной лимит по IP (см.
    // lib/anonymousUsage.js). До этой фичи анонимный доступ был вообще
    // безлимитным, в отличие от платных клиентов — тот же принцип защиты,
    // просто на другом уровне (день, не разовый пакет).
    let usage;
    try {
      usage = await consumeAnonymousUsage(clientIp);
    } catch (_) {
      throw new RecognizeError('Счётчик дневного лимита недоступен. Обратитесь к администратору сайта. Запрос в Gemini не отправлен.', 503, 'QUOTA_UNAVAILABLE');
    }
    if (!usage.allowed) {
      throw new RecognizeError(
        `Бесплатный дневной лимит исчерпан (${usage.pagesUsed}/${usage.dailyLimit} страниц в день с вашего адреса). Попробуйте завтра или обратитесь для подключения платного пакета.`,
        402
      );
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const clientConfig = (clientApiKey || clientSlug)
    ? await getClientConfig({ apiKey: clientApiKey, clientSlug })
    : null;
  const customFields = clientConfig ? clientConfig.fields : null;
  const fieldOverrides = clientConfig ? clientConfig.fieldOverrides : null;
  const customDocTypes = clientConfig ? clientConfig.customDocTypes : null;
  const formatting = clientConfig ? clientConfig.formatting : null;
  if (includeText === undefined) includeText = formatting?.includeText !== false;
  // businessRules (Ethan, 10 сен 2026, "бизнес-правила видит только сайт,
  // публичный API/вебхуки — нет") — уже провалидированы при чтении конфига
  // (см. customFieldsLookup.js), здесь просто прокидываются в проверку в
  // конце функции (см. warnings ниже). Анонимные посетители (clientConfig
  // == null) не могут настроить правила вообще — для них массив пуст,
  // checkBusinessRules просто ничего клиентского не найдёт.
  const businessRules = clientConfig ? clientConfig.businessRules : [];
  const automatic = !isValidDocType(docType, customDocTypes);
  const startedAt = Date.now();
  let parsed, usage, extraction;
  try {
    if (automatic) {
      const classification = await callGemini({
        apiKey, mimeType, base64,
        instruction: buildClassificationInstruction(customDocTypes),
        schemaProperties: classificationSchemaField(customDocTypes),
        requiredFields: ['documentType']
      });
      usage = classification.usage;
      if (!isValidDocType(classification.result?.documentType, customDocTypes)) {
        throw new GeminiError('Gemini вернул некорректный результат классификации', 502);
      }
      docType = classification.result.documentType;
    }
    extraction = buildInstructionAndSchema(docType, { includeText, customFields, customDocTypes, formatting, fieldOverrides });
    const response = await callGemini({
      apiKey, mimeType, base64, instruction: extraction.instruction,
      schemaProperties: extraction.schemaProperties, requiredFields: extraction.requiredFields
    });
    usage = automatic ? combineUsage(usage, response.usage) : response.usage;
    parsed = response.result;
    if (automatic && parsed?.__unparsed !== undefined) {
      throw new GeminiError('Gemini вернул некорректный результат извлечения', 502);
    }
  } catch (err) {
    const errorLatencyMs = Date.now() - startedAt;
    logRecognitionError({
      status: err instanceof GeminiError ? err.status : 500,
      message: err.message,
      latencyMs: errorLatencyMs,
      clientSlug, clientApiKey, clientIp
    });
    await safeRecordBatchDocument({ batchId, apiKey: clientApiKey, docType: docType || null, success: false });
    await safeRecordUsageEvent({ clientRef: usageClientRef, docType: docType || null, success: false, confidence: null, usage, latencyMs: errorLatencyMs });
    if (err instanceof GeminiError) throw new RecognizeError(err.message, err.status);
    throw err;
  }
  const latencyMs = Date.now() - startedAt;
  const { tableMode, tableColumns, hasTotals, omitText } = extraction;

  if (parsed.__unparsed !== undefined) {
    logRecognition({
      docType: docType || 'Другое', confidence: null, tableMode, usage, latencyMs,
      clientSlug, clientApiKey, clientIp
    });
    await safeRecordBatchDocument({ batchId, apiKey: clientApiKey, docType: docType || 'Другое', success: true });
    await safeRecordUsageEvent({ clientRef: usageClientRef, docType: docType || 'Другое', success: true, confidence: null, usage, latencyMs });
    return { text: omitText ? '' : parsed.__unparsed.trim(), documentType: docType || 'Другое', fields: [], items: [], confidence: null, warnings: [] };
  }

  const finalDocType = docType;
  // (!tableMode || hasTotals) — карточные типы всегда читают fields как раньше;
  // табличные типы читают fields ТОЛЬКО когда у них есть totals (см.
  // buildInstructionAndSchema) — иначе Gemini не просили это поле вовсе, и
  // читать parsed.fields было бы некорректно (undefined в лучшем случае).
  const rawFields = (!tableMode || hasTotals) && Array.isArray(parsed.fields) && parsed.fields.length ? parsed.fields : [];
  const rawItems = tableMode && Array.isArray(parsed.items) && parsed.items.length ? parsed.items : [];

  const result = {
    text: omitText ? '' : (parsed.text || '').trim(),
    documentType: finalDocType,
    // Нормализация форматов (даты → ДД.ММ.ГГГГ, суммы → запятая, либо override
    // из конфига клиента) — единое место для веб-интерфейса и для публичного
    // API (api/v1/recognize.js), которым оба пользуются этой же функцией.
    fields: normalizeFields(rawFields, formatting),
    items: tableMode ? normalizeItems(rawItems, tableColumns.columns, tableColumns.keys, formatting) : [],
    // Самооценка модели (0-100, см. lib/confidence.js) — нормализована на случай
    // не-числового/вне-диапазона ответа (см. fieldFormat.js:normalizeConfidence).
    confidence: normalizeConfidence(parsed.confidence)
  };
  logRecognition({
    docType: result.documentType, confidence: result.confidence, tableMode, tableFollowUp: automatic && tableMode, usage, latencyMs,
    clientSlug, clientApiKey, clientIp
  });
  await safeRecordBatchDocument({ batchId, apiKey: clientApiKey, docType: result.documentType, success: true });
  await safeRecordUsageEvent({ clientRef: usageClientRef, docType: result.documentType, success: true, confidence: result.confidence, usage, latencyMs });
  // Include the layout even for empty tables, for manual editing.
  if (tableMode) {
    result.columns = tableColumns.columns;
    result.columnKeys = tableColumns.keys;
  }
  // warnings (Ethan, 10 сен 2026) — та же проверка бизнес-правил, что раньше
  // выполнялась ТОЛЬКО в браузере (public/js/postprocess/businessRules.js) —
  // теперь считается здесь, один раз, для ЛЮБОГО вызывающего канала (сайт,
  // публичный /api/v1/recognize, батчи с вебхуком), а не только для того, кто
  // открыл веб-интерфейс. result.fields на этот момент уже финальный —
  // включает и обычные карточные поля, и totals табличных типов (после
  // возможного дозапроса за таблицей выше), поэтому правила вроде
  // percentage_match между "Сумма без НДС"/"Сумма НДС" видят те же значения,
  // что видит пользователь на сайте. Веб-интерфейс продолжает ДОПОЛНИТЕЛЬНО
  // пересчитывать это же на клиенте (нужно для мгновенной перепроверки при
  // ручном редактировании поля без round-trip на сервер) — здесь не дублируем
  // эту логику намеренно, оба места используют одинаковую проверку (см.
  // комментарий в lib/postprocess/businessRules.js про синхронность копий).
  result.warnings = checkBusinessRules(result.fields, businessRules, result.documentType);

  return result;
}

module.exports = { recognizeDocument, RecognizeError, ALLOWED_MIME_TYPES };
