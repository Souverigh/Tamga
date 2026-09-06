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
const { isTableType } = require('./docSchema');
const { normalizeFields, normalizeItems } = require('./fieldFormat');
const { callGemini, GeminiError } = require('./geminiClient');
const { getClientConfig, consumeUsage } = require('./customFieldsLookup');

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
// skipOcr — не запрашивать у модели текст заново. Нужно для follow-up запроса
// при авто-детекте табличного типа (см. app.js): первый запрос уже вернул
// полный text, и просить его ещё раз во втором запросе — чистая избыточность,
// раздувающая объём ответа без всякой пользы (см. обсуждение по 504).
// customDocTypes/formatting — из конфига клиента (см. customFieldsLookup.js),
// прокидываются насквозь в classification.js/extraction.js.
function buildInstructionAndSchema(knownDocType, { skipOcr = false, customFields = null, customDocTypes = null, formatting = null, fieldOverrides = null } = {}) {
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

  const instructionParts = [];
  if (!skipOcr) instructionParts.push(buildOcrInstruction());
  if (!skipClassification) instructionParts.push(buildClassificationInstruction(customDocTypes));
  // customFields имеет смысл только для карточных типов с уже известным docType —
  // extraction.js сам их игнорирует в остальных случаях, но не считаем лишним
  // не передавать их туда, где они заведомо неприменимы (табличный/неизвестный тип).
  instructionParts.push(buildExtractionInstruction(knownDocType, { customFields, customDocTypes, formatting, fieldOverrides }));

  const schemaProperties = {
    ...(skipOcr ? {} : ocrSchemaField()),
    ...(skipClassification ? {} : classificationSchemaField(customDocTypes)),
    ...(tableMode ? itemsSchemaField(knownDocType, fieldOverrides) : extractionSchemaField())
  };
  const requiredFields = [
    ...(skipOcr ? [] : ['text']),
    tableMode ? 'items' : 'fields',
    ...(skipClassification ? [] : ['documentType'])
  ];

  return { instruction: instructionParts.join(' '), schemaProperties, requiredFields, skipClassification, tableMode, tableColumns };
}

// Основная функция распознавания. Ключ Gemini берётся только из переменной
// окружения на сервере — никогда не передаётся и не логируется как параметр.
// docType — необязательный: если передан, классификация не выполняется вообще.
// skipOcr — см. buildInstructionAndSchema; text в ответе будет пустой строкой.
// clientApiKey — НЕ ключ Gemini (тот ниже, из env): это x-api-key бизнеса-интеграции
// (см. api/v1/recognize.js). clientSlug — идентификатор клиента в веб-интерфейсе
// (см. api/recognize.js, ?client=acme). Ровно один из них (или ни одного) может
// быть передан — оба используются только чтобы найти конфиг клиента в Supabase
// (см. customFieldsLookup.js: кастомные поля, кастомные типы документов,
// форматирование). Без них — поведение по умолчанию не меняется ни для кого.
async function recognizeDocument({ base64, mimeType, docType, skipOcr, clientApiKey, clientSlug }) {
  validateInput({ base64, mimeType });

  // Разовый пакет страниц (page_limit/pages_used, см. миграцию
  // tamga_add_page_usage_limit) — проверяем и сразу инкрементируем ДО вызова
  // Gemini (не после), чтобы не тратить платный вызов модели на страницу,
  // которая всё равно будет заблокирована лимитом.
  //
  // !skipOcr — считаем только ОСНОВНОЙ запрос за страницу. Follow-up запрос
  // на добор таблицы (skipOcr: true, см. app.js: needsTableFollowUp) — это
  // та же самая страница, просто Gemini понадобилось запросить дважды из-за
  // особенностей табличных типов; клиент платит за страницу, а не за то,
  // сколько внутренних вызовов Gemini она стоила нам технически.
  if (!skipOcr && (clientApiKey || clientSlug)) {
    const usage = await consumeUsage({ apiKey: clientApiKey, clientSlug });
    if (!usage.allowed) {
      throw new RecognizeError(
        `Лимит страниц по вашему тарифу исчерпан (${usage.pagesUsed}/${usage.pageLimit}). Обратитесь к администратору для пополнения пакета.`,
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
  const { instruction, schemaProperties, requiredFields, skipClassification, tableMode, tableColumns } = buildInstructionAndSchema(docType, { skipOcr, customFields, customDocTypes, formatting, fieldOverrides });

  let parsed;
  try {
    parsed = await callGemini({ apiKey, instruction, mimeType, base64, schemaProperties, requiredFields });
  } catch (err) {
    if (err instanceof GeminiError) throw new RecognizeError(err.message, err.status);
    throw err;
  }

  if (parsed.__unparsed !== undefined) {
    return { text: skipOcr ? '' : parsed.__unparsed.trim(), documentType: docType || 'Другое', fields: [], items: [] };
  }

  const finalDocType = skipClassification ? docType : (parsed.documentType || 'Другое');
  const rawFields = !tableMode && Array.isArray(parsed.fields) && parsed.fields.length ? parsed.fields : [];
  const rawItems = tableMode && Array.isArray(parsed.items) && parsed.items.length ? parsed.items : [];

  const result = {
    text: skipOcr ? '' : (parsed.text || '').trim(),
    documentType: finalDocType,
    // Нормализация форматов (даты → ДД.ММ.ГГГГ, суммы → запятая, либо override
    // из конфига клиента) — единое место для веб-интерфейса и для публичного
    // API (api/v1/recognize.js), которым оба пользуются этой же функцией.
    fields: normalizeFields(rawFields, formatting),
    items: tableMode ? normalizeItems(rawItems, tableColumns.columns, tableColumns.keys, formatting) : []
  };
  // columns/columnKeys — реально использованная раскладка (см. tableColumns
  // выше) — нужна фронтенду для корректного рендера/экспорта, т.к. при клиентском
  // override она отличается от статичной схемы docSchema.js. Отдаётся только
  // при tableMode — для остальных типов у фронтенда и так есть статичная схема.
  if (tableMode) {
    result.columns = tableColumns.columns;
    result.columnKeys = tableColumns.keys;
  }
  return result;
}

module.exports = { recognizeDocument, RecognizeError, ALLOWED_MIME_TYPES };
