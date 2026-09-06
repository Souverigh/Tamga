// Извлечение структурированных полей — независимый модуль.
// Не знает, как определяется тип документа (это дело classification.js) —
// только берёт готовый тип (или список всех типов, если тип неизвестен)
// и строит инструкцию + схему для извлечения полей под него.
//
// Работает в двух режимах:
//   - docType известен заранее (пользователь выбрал вручную в интерфейсе) —
//     классификация вообще не нужна, извлекаем поля сразу под этот тип;
//   - docType неизвестен — извлекаем поля под тип, который определит
//     классификация в этом же запросе (см. recognize.js, где оба модуля
//     объединяются в один вызов Gemini ради экономии).

const { DOC_TYPES, DOC_FIELDS, isTableType, columnsForType, keysForType, descriptionForType } = require('./docSchema');

// Общие требования к формату значений и поведению при неуверенности — добавляются
// в конец любой инструкции по извлечению. Без этого Gemini может отдавать даты и
// суммы в произвольном формате от документа к документу (12.01.1990 vs 1990-01-12
// vs "12 января 1990"), что осложняет экспорт в Excel/1С. Серверная нормализация
// в lib/fieldFormat.js подчищает то, что модель всё же не отформатирует правильно —
// это не замена промпту, а подстраховка на случай, если модель проигнорирует инструкцию.
const FORMAT_GUIDANCE = 'Format every date as DD.MM.YYYY (e.g. "05.09.2026"). Format numeric amounts using a comma as the decimal separator (e.g. "1250,50"), without currency symbols unless a field explicitly asks for one. Use this format even if the source document writes dates or numbers differently.';
const UNCERTAINTY_GUIDANCE = 'If a value is partially illegible, provide your best reading of it. If a field is genuinely absent from the document, leave it as an empty string — never invent a value that is not indicated anywhere in the document.';
// Без этой инструкции модель иногда "причёсывает" значения: переводит кыргызский текст
// на русский (или наоборот), или путает визуально похожие символы кириллицы/цифр в
// идентификаторах (серии документов, ПИН, VIN, госномера) — такие ошибки не ловит
// последующая нормализация в lib/fieldFormat.js, т.к. она не знает исходного изображения.
const TRANSCRIPTION_GUIDANCE = 'Transcribe names, addresses and other free-text values exactly as written, in their original language and script — never translate between Russian and Kyrgyz, and never paraphrase or "correct" spelling. For identifiers such as series/document numbers, ПИН (ИНН), VIN, license plates and similar codes, transcribe every character exactly as printed, paying close attention to visually similar Cyrillic-letter/digit pairs (О vs 0, З vs 3, б vs 6, В vs 8) — when in doubt, prefer the reading that matches the identifier\'s usual pattern (e.g. an identifier that is otherwise all digits is unlikely to contain a stray Cyrillic letter).';

// Карта полей только для «плоских» (label/value) типов — используется как
// запасной вариант и для промпта, когда тип неизвестен заранее (см. ниже:
// в этом случае табличные типы вроде накладной из карты исключаются, т.к.
// их нельзя корректно описать как label/value — см. buildExtractionInstruction).
function flatFieldsMap() {
  return Object.fromEntries(Object.entries(DOC_FIELDS).filter(([, v]) => Array.isArray(v)));
}

function fieldsForType(docType) {
  const entry = DOC_FIELDS[docType];
  if (Array.isArray(entry)) return entry;
  return DOC_FIELDS['Другое'];
}

// Инструкция для модели.
//   - Тип известен заранее и это табличный тип (накладная/УПД) — просим
//     массив товарных строк (items), а не label/value.
//   - Тип известен заранее и обычный — даём только его набор полей (короче и точнее промпт).
//   - Тип неизвестен — даём полную карту полей по «плоским» типам, модель сама
//     подставит нужный набор под тип, который определит. Табличные типы в эту
//     карту не входят: без знания типа заранее классификация+извлечение идёт
//     одним вызовом, и авто-классификация в накладную сейчас не поддерживается —
//     пользователь должен выбрать этот тип вручную в интерфейсе (см. app.js).
// formatOverride (опционально) — { dateFormat, decimalSeparator } из конфига
// клиента (см. customFieldsLookup.js) — подменяет глобальный FORMAT_GUIDANCE,
// когда у клиента другие требования к формату (напр. точка вместо запятой).
function formatGuidanceFor(formatOverride) {
  if (!formatOverride) return FORMAT_GUIDANCE;
  const dateFormat = formatOverride.dateFormat || 'DD.MM.YYYY';
  const separator = formatOverride.decimalSeparator || ',';
  const dateExample = dateFormat === 'YYYY-MM-DD' ? '2026-09-05' : '05.09.2026';
  const amountExample = separator === '.' ? '1250.50' : '1250,50';
  return `Format every date as ${dateFormat} (e.g. "${dateExample}"). Format numeric amounts using "${separator}" as the decimal separator (e.g. "${amountExample}"), without currency symbols unless a field explicitly asks for one. Use this format even if the source document writes dates or numbers differently.`;
}

// customDocTypes (опционально) — доп. типы конкретного клиента, вида
// { "Название типа": { fields: [...], hint: "..." } } (см. classification.js).
// Такие типы сейчас всегда «карточные» (label/value) — табличная структура
// для кастомных типов вне scope, как и для customFields ниже.
function buildExtractionInstruction(knownDocType, { customFields, customDocTypes, formatting, fieldOverrides } = {}) {
  const FORMAT = formatGuidanceFor(formatting);

  if (customDocTypes && customDocTypes[knownDocType]) {
    const entry = customDocTypes[knownDocType];
    const fields = Array.isArray(entry.fields) && entry.fields.length ? entry.fields : ['Значение'];
    const context = entry.hint ? ` — ${entry.hint}` : '';
    return `The document type is already known: "${knownDocType}"${context}. Extract structured fields as label/value pairs using EXACTLY these Russian field labels (leave value as an empty string if not present in the document): ${JSON.stringify(fields)}. ${FORMAT} ${TRANSCRIPTION_GUIDANCE} ${UNCERTAINTY_GUIDANCE}`;
  }
  if (knownDocType && isTableType(knownDocType)) {
    const columns = columnsForType(knownDocType);
    const keys = keysForType(knownDocType);
    const description = descriptionForType(knownDocType);
    return `The document type is already known: "${knownDocType}" — ${description}. Extract EVERY row as an object with keys ${JSON.stringify(keys)} corresponding to these Russian columns in order: ${JSON.stringify(columns)}. Leave a key as an empty string if that cell is missing for a row. Return one object per row, in the same order as in the document. ${FORMAT} ${TRANSCRIPTION_GUIDANCE} ${UNCERTAINTY_GUIDANCE}`;
  }
  if (knownDocType && DOC_TYPES.includes(knownDocType)) {
    // Приоритет источников списка полей для известного типа (см. customFieldsLookup.js):
    //   1. field_overrides[тип] — переопределение ИМЕННО для этого типа (см. админку /admin)
    //   2. customFields — старый общий override "для любого типа" (обратная совместимость,
    //      уже используется реальным клиентом с одним всегда известным типом документа)
    //   3. fieldsForType(тип) — стандартный список полей
    const overrideForType = fieldOverrides && Array.isArray(fieldOverrides[knownDocType]) && fieldOverrides[knownDocType].length
      ? fieldOverrides[knownDocType]
      : null;
    const fields = overrideForType || (customFields && customFields.length ? customFields : fieldsForType(knownDocType));
    return `The document type is already known: "${knownDocType}". Extract structured fields as label/value pairs using EXACTLY these Russian field labels (leave value as an empty string if not present in the document): ${JSON.stringify(fields)}. ${FORMAT} ${TRANSCRIPTION_GUIDANCE} ${UNCERTAINTY_GUIDANCE}`;
  }
  // Тип неизвестен заранее (авто-классификация в этом же запросе) — карта полей
  // должна покрывать и глобальные типы (с учётом field_overrides для них), и
  // кастомные типы этого клиента, иначе если Gemini классифицирует документ в
  // кастомный тип или тип с переопределением, извлекать поля будет не по чему.
  const baseMap = flatFieldsMap();
  const withOverrides = fieldOverrides
    ? Object.fromEntries(Object.entries(baseMap).map(([type, flds]) => [type, (fieldOverrides[type] && fieldOverrides[type].length) ? fieldOverrides[type] : flds]))
    : baseMap;
  const fieldsMap = customDocTypes
    ? { ...withOverrides, ...Object.fromEntries(Object.entries(customDocTypes).map(([type, entry]) => [type, entry.fields || ['Значение']])) }
    : withOverrides;
  return `Based on the detected category, extract structured fields as label/value pairs. Use EXACTLY the Russian field labels for that category from this mapping (leave value as an empty string if not present in the document): ${JSON.stringify(fieldsMap)}. ${FORMAT} ${TRANSCRIPTION_GUIDANCE} ${UNCERTAINTY_GUIDANCE}`;
}

// Фрагмент JSON-схемы ответа, описывающий массив полей label/value.
function extractionSchemaField() {
  return {
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
  };
}

// Фрагмент JSON-схемы ответа, описывающий массив строк табличного типа.
// docType обязателен — у каждого табличного типа теперь свои ключи (см. docSchema.js).
function itemsSchemaField(docType) {
  const keys = keysForType(docType);
  const properties = Object.fromEntries(keys.map(k => [k, { type: 'STRING' }]));
  return {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties,
        required: keys
      }
    }
  };
}

module.exports = { buildExtractionInstruction, extractionSchemaField, itemsSchemaField, fieldsForType };
