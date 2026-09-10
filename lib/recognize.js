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

// Собирает промпт и схему ответа из независимых модулей.
// knownDocType — опциональный тип документа, если он уже известен (пропускает классификацию).
// skipOcr — не запрашивать у модели текст заново. Нужно ТОЛЬКО для внутреннего
// follow-up запроса при авто-детекте табличного типа (см. app.js): первый запрос
// уже вернул полный text, и просить его ещё раз во втором запросе — чистая
// избыточность. Эту же страницу пользователь НЕ платит дважды — см. recognizeDocument,
// подсчёт usage завязан именно на skipOcr, а не на includeText ниже.
//
// includeText (Ethan, 9 сен 2026: "что если человеку не нужен полный текст") —
// НЕЗАВИСИМЫЙ от skipOcr параметр, доступный пользователю/API снаружи (в
// отличие от skipOcr — тот сугубо внутренний механизм). По умолчанию true —
// ничего не меняется для тех, кто его не трогает. ВАЖНО: намеренно НЕ переиспользуем
// skipOcr напрямую для этой цели, хотя оба в итоге просто убирают text из
// промпта/схемы — skipOcr одновременно означает "эта страница не расходует
// лимит" (см. recognizeDocument), и если бы включение "не нужен текст" молча
// пропускало списание страницы, клиент получал бы страницы бесплатно, просто
// попросив без текста. Здесь же полный текст не нужен, а СТРАНИЦА всё равно
// обрабатывается по-настоящему и должна списываться как обычно.
//
// customDocTypes/formatting — из конфига клиента (см. customFieldsLookup.js),
// прокидываются насквозь в classification.js/extraction.js.
function buildInstructionAndSchema(knownDocType, { skipOcr = false, includeText = true, customFields = null, customDocTypes = null, formatting = null, fieldOverrides = null } = {}) {
  const skipClassification = knownDocType && isValidDocType(knownDocType, customDocTypes);
  // Табличные типы (накладная/УПД, справочник номенклатуры) сейчас поддерживаются
  // только когда тип известен заранее (пользователь выбрал вручную) — см.
  // комментарий в extraction.js про buildExtractionInstruction. При неизвестном
  // типе схема всегда описывает fields (label/value), даже если Gemini
  // классифицирует документ как табличный тип — тогда fields придут пустыми
  // (см. recognizeDocument). Кастомные типы клиента всегда карточные (см. extraction.js).
  const tableMode = skipClassification && isTableType(knownDocType);
  // Реально использованная раскладка колонок (стандартная либо клиентский
  // override, см. extraction.js:resolveTableColumns) — считается ОДИН раз
  // здесь и передаётся и в схему ответа, и наружу в recognizeDocument, чтобы
  // промпт/схема/ответ фронтенду были гарантированно синхронны между собой.
  const tableColumns = tableMode ? resolveTableColumns(knownDocType, fieldOverrides) : null;
  // hasTotals (Ethan, 9 сен 2026, "НДС стоит, но не распознаётся") — табличный
  // тип, у которого ЕСТЬ документ-уровневый блок итогов (см. docSchema.js:
  // totalsForType). Когда true, схема ответа запрашивает И items (строки), И
  // fields (итоги) в одном вызове — это НЕ альтернатива tableMode, а его
  // расширение для типов, где totals определены (Справочник номенклатуры,
  // например, останется чисто table-режимом без fields, т.к. totals там нет).
  const totalsList = tableMode ? totalsForType(knownDocType) : null;
  const hasTotals = !!totalsList;

  // omitText — итоговое решение "не просить у модели текст в этом промпте",
  // объединяет обе независимые причины (см. комментарий выше у параметров).
  const omitText = skipOcr || !includeText;

  const instructionParts = [];
  if (!omitText) instructionParts.push(buildOcrInstruction());
  if (!skipClassification) instructionParts.push(buildClassificationInstruction(customDocTypes));
  // customFields имеет смысл только для карточных типов с уже известным docType —
  // extraction.js сам их игнорирует в остальных случаях, но не считаем лишним
  // не передавать их туда, где они заведомо неприменимы (табличный/неизвестный тип).
  instructionParts.push(buildExtractionInstruction(knownDocType, { customFields, customDocTypes, formatting, fieldOverrides }));
  // Уверенность запрашиваем ВСЕГДА, независимо от omitText/tableMode — даже
  // follow-up запрос на добор таблицы (skipOcr: true) должен вернуть свою
  // оценку, т.к. она относится к качеству извлечения ЭТОГО конкретного ответа
  // (строк таблицы), а не переиспользуется от первого запроса (см. app.js:
  // recognizePage — там оценки обоих запросов сводятся в одну по минимуму).
  instructionParts.push(buildConfidenceInstruction());

  // needsFields — нетабличные типы всегда просят "fields" (как раньше), а
  // табличные типы просят его ДОПОЛНИТЕЛЬНО только когда есть totals (см.
  // hasTotals выше) — иначе (напр. Справочник номенклатуры) схема ответа
  // остаётся прежней, чисто "items", без лишнего поля в JSON-схеме Gemini.
  const needsFields = !tableMode || hasTotals;
  const schemaProperties = {
    ...(omitText ? {} : ocrSchemaField()),
    ...(skipClassification ? {} : classificationSchemaField(customDocTypes)),
    ...(tableMode ? itemsSchemaField(knownDocType, fieldOverrides) : {}),
    ...(needsFields ? extractionSchemaField(hasTotals ? totalsList.length : null) : {}),
    ...confidenceSchemaField()
  };
  const requiredFields = [
    ...(omitText ? [] : ['text']),
    ...(tableMode ? ['items'] : []),
    ...(needsFields ? ['fields'] : []),
    ...(skipClassification ? [] : ['documentType']),
    'confidence'
  ];

  return { instruction: instructionParts.join(' '), schemaProperties, requiredFields, skipClassification, tableMode, tableColumns, hasTotals, omitText };
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

// a/b — 0-100 либо null (модель не смогла дать оценку). null — "неизвестно",
// не "отлично"/"плохо" — поэтому если один из них null, побеждает другой, а
// не автоматически более низкое число. Используется при объединении оценки
// основного запроса и служебного дозапроса за таблицей (см. recognizeDocument
// ниже) — та же логика, что раньше была в public/js/app.js для клиентского
// объединения тех же двух чисел, просто теперь оба запроса идут на сервере.
function minConfidence(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
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
  const { instruction, schemaProperties, requiredFields, skipClassification, tableMode, tableColumns, hasTotals, omitText } = buildInstructionAndSchema(docType, { includeText, customFields, customDocTypes, formatting, fieldOverrides });

  // Замеряем именно время вызова Gemini отдельно от остального (Supabase-запросы
  // выше, нормализация ниже) — это то самое число, которое интересовало в
  // обсуждении скорости пачки (см. TECH_DEBT.md), и его теперь видно на КАЖДЫЙ
  // вызов в логах, а не только по логам Vercel на уровне всей функции целиком.
  const startedAt = Date.now();
  let parsed, usage;
  try {
    ({ result: parsed, usage } = await callGemini({ apiKey, instruction, mimeType, base64, schemaProperties, requiredFields }));
  } catch (err) {
    const errorLatencyMs = Date.now() - startedAt;
    logRecognitionError({
      status: err instanceof GeminiError ? err.status : 500,
      message: err.message,
      latencyMs: errorLatencyMs,
      clientSlug, clientApiKey, clientIp
    });
    await safeRecordBatchDocument({ batchId, apiKey: clientApiKey, docType: docType || null, success: false });
    await safeRecordUsageEvent({ clientRef: usageClientRef, docType: docType || null, success: false, confidence: null, usage: null, latencyMs: errorLatencyMs });
    if (err instanceof GeminiError) throw new RecognizeError(err.message, err.status);
    throw err;
  }
  const latencyMs = Date.now() - startedAt;

  if (parsed.__unparsed !== undefined) {
    logRecognition({
      docType: docType || 'Другое', confidence: null, tableMode, usage, latencyMs,
      clientSlug, clientApiKey, clientIp
    });
    await safeRecordBatchDocument({ batchId, apiKey: clientApiKey, docType: docType || 'Другое', success: true });
    await safeRecordUsageEvent({ clientRef: usageClientRef, docType: docType || 'Другое', success: true, confidence: null, usage, latencyMs });
    return { text: omitText ? '' : parsed.__unparsed.trim(), documentType: docType || 'Другое', fields: [], items: [], confidence: null };
  }

  const finalDocType = skipClassification ? docType : (parsed.documentType || 'Другое');
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
  let finalTableColumns = tableColumns;
  let tableFollowUpUsed = false;

  // Табличный тип, определённый ТОЛЬКО ЧТО (тип не был известен заранее —
  // skipClassification=false) — первый запрос физически не мог сразу попросить
  // items (см. buildInstructionAndSchema: tableMode требует ЗАРАНЕЕ известный
  // tableType). Дозапрашиваем строки таблицы ВТОРЫМ, внутренним вызовом
  // Gemini — та же страница, тот же вызывающий, просто технически нужно два
  // обращения к модели (Ethan, 8-9 сен 2026: раньше это делал клиент отдельным
  // HTTP-запросом с skipOcr:true, см. комментарий про подсчёт страниц выше —
  // теперь целиком здесь, наружу skipOcr не течёт вообще).
  if (!skipClassification && isTableType(finalDocType) && rawItems.length === 0) {
    try {
      const followUp = buildInstructionAndSchema(finalDocType, {
        skipOcr: true, // внутренний флаг buildInstructionAndSchema — текст уже есть с первого запроса, спрашивать заново незачем
        customFields, customDocTypes, formatting, fieldOverrides
      });
      const { result: tableParsed } = await callGemini({
        apiKey, instruction: followUp.instruction, mimeType, base64,
        schemaProperties: followUp.schemaProperties, requiredFields: followUp.requiredFields
      });
      const rawTableItems = Array.isArray(tableParsed.items) && tableParsed.items.length ? tableParsed.items : [];
      // Итоги (см. hasTotals выше) дозапрашиваются в ЭТОМ ЖЕ дозапросе за
      // таблицей — followUp уже правильно определил hasTotals для finalDocType
      // (тип теперь известен) и включил "fields" в его схему/промпт наравне
      // с "items", так что второй HTTP-вызов Gemini не нужен.
      const rawTableTotals = followUp.hasTotals && Array.isArray(tableParsed.fields) && tableParsed.fields.length ? tableParsed.fields : [];
      result.documentType = finalDocType;
      result.items = normalizeItems(rawTableItems, followUp.tableColumns.columns, followUp.tableColumns.keys, formatting);
      result.fields = normalizeFields(rawTableTotals, formatting);
      result.confidence = minConfidence(result.confidence, normalizeConfidence(tableParsed.confidence));
      finalTableColumns = followUp.tableColumns;
      tableFollowUpUsed = true;
    } catch (err) {
      // Дозапрос не удался (например, 504) — не роняем весь ответ: текст и
      // тип у нас уже есть с первого запроса, таблица просто останется
      // пустой для ручного заполнения. items — ЯВНО null, не [] по умолчанию:
      // семантически точнее для прямых потребителей ответа API ("строк нет,
      // потому что дозапрос не удался" — не то же самое, что "строк нет,
      // потому что документ действительно пуст"). Для самого веб-интерфейса
      // разницы на практике нет — geminiRecognizeClient.js всё равно приводит
      // и [], и null к одному null при разборе ответа.
      result.items = null;
      console.error('recognize: дозапрос за таблицей не удался, отдаём без строк:', err.message);
    }
  }

  logRecognition({
    docType: result.documentType, confidence: result.confidence, tableMode, tableFollowUp: tableFollowUpUsed, usage, latencyMs,
    clientSlug, clientApiKey, clientIp
  });
  await safeRecordBatchDocument({ batchId, apiKey: clientApiKey, docType: result.documentType, success: true });
  await safeRecordUsageEvent({ clientRef: usageClientRef, docType: result.documentType, success: true, confidence: result.confidence, usage, latencyMs });
  // columns/columnKeys — реально использованная раскладка (см. tableColumns/
  // finalTableColumns выше) — нужна фронтенду для корректного рендера/экспорта,
  // т.к. при клиентском override она отличается от статичной схемы docSchema.js.
  // Отдаётся при tableMode ИЛИ когда табличный тип определился по дозапросу
  // выше (result.items уже заполнен, а исходный tableMode было false).
  if (tableMode || (finalTableColumns && result.items.length)) {
    result.columns = finalTableColumns.columns;
    result.columnKeys = finalTableColumns.keys;
  }
  return result;
}

module.exports = { recognizeDocument, RecognizeError, ALLOWED_MIME_TYPES };
