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

const { APOSTILLE_FIELDS, buildApostilleExtractionInstruction } = require('./apostille');
const { verifyApostilleValues } = require('./verification');
const { DOC_TYPES } = require('../docSchema');
const { getClientConfig } = require('../customFieldsLookup');
const { callGemini, GeminiError } = require('../geminiClient');
const { consumeUsage } = require('../customFieldsLookup');
const { recordUsageEvent } = require('../usageAnalytics');
const { validateTranslationRequest, translateSegments } = require('../translation');
const { lookupTransliterations } = require('../verifiedTransliterations');

class TranslationDocError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

const STANDARD_TRANSLATION_FIELDS = {
  'Паспорт / удостоверение личности': ['ФИО', 'Дата рождения', 'Пол', 'Гражданство', 'Серия и номер', 'ПИН (ИНН)', 'Дата выдачи', 'Дата окончания', 'Орган выдачи'],
  'Водительское удостоверение': ['ФИО', 'Дата рождения', 'Категории', 'Серия и номер', 'Дата выдачи', 'Дата окончания', 'Орган выдачи'],
  'Военный билет': ['ФИО', 'Дата рождения', 'Воинское звание', 'Серия и номер', 'Воинская часть', 'Дата выдачи'],
  'Свидетельство о рождении': ['ФИО ребёнка', 'Дата рождения', 'Место рождения', 'ФИО отца', 'ФИО матери', 'Номер записи', 'Дата выдачи'],
  'Свидетельство о браке': ['ФИО супруга', 'ФИО супруги', 'Дата заключения брака', 'Место заключения брака', 'Фамилия после брака', 'Номер записи', 'Дата выдачи'],
  'Свидетельство о расторжении брака': ['ФИО супругов', 'Дата расторжения брака', 'Номер записи', 'Дата выдачи', 'Орган выдачи'],
  'Свидетельство о смерти': ['ФИО умершего', 'Дата рождения', 'Дата смерти', 'Место смерти', 'Причина смерти', 'Номер записи', 'Дата выдачи'],
  'Диплом / аттестат': ['ФИО', 'Учебное заведение', 'Квалификация', 'Специальность', 'Серия и номер', 'Дата выдачи'],
  'Справка': ['Вид справки', 'ФИО', 'Дата рождения', 'Место работы/учёбы', 'Должность', 'Период', 'Дата выдачи', 'Орган выдачи'],
  'Договор': ['Вид договора', 'Номер договора', 'Дата договора', 'Сторона 1', 'Сторона 2', 'Предмет договора', 'Сумма', 'Срок действия', 'Подписи'],
  'Доверенность': ['Доверитель', 'Представитель', 'Полномочия', 'Номер', 'Дата выдачи', 'Срок действия', 'Орган выдачи'],
  'Банковский документ': ['Банк', 'Номер счёта', 'Владелец счёта', 'Период', 'Дата операции', 'Операции', 'Итоговый остаток', 'Валюта'],
  'Платёжное поручение': ['Номер', 'Дата', 'Плательщик', 'ИНН плательщика', 'Получатель', 'ИНН получателя', 'Сумма', 'Назначение платежа'],
  'Квитанция / чек': ['Номер', 'Дата', 'Продавец', 'Покупатель', 'Наименование', 'Сумма', 'Валюта'],
  'Накладная / УПД': ['Номер', 'Дата', 'Поставщик', 'Покупатель', 'Наименование товаров', 'Количество', 'Сумма', 'НДС', 'Итого'],
  'Счёт-фактура / Инвойс': ['Номер', 'Дата', 'Продавец', 'Покупатель', 'Наименование товаров', 'Количество', 'Сумма без НДС', 'НДС', 'Итого'],
  'Акт выполненных работ': ['Номер', 'Дата', 'Исполнитель', 'Заказчик', 'Описание работ', 'Количество', 'Сумма', 'НДС', 'Итого'],
  'Справочник номенклатуры': ['Код', 'Наименование', 'Единица измерения', 'Цена', 'Ставка НДС'],
  'Техпаспорт автомобиля': ['Марка и модель', 'Государственный номер', 'VIN', 'Год выпуска', 'Владелец', 'Дата выдачи'],
  'Документы на недвижимость': ['Владелец', 'Адрес', 'Кадастровый номер', 'Площадь', 'Вид права', 'Дата выдачи', 'Орган выдачи'],
  'Другое': ['Название документа', 'Номер', 'Дата', 'Организация', 'Стороны', 'Предмет', 'Суммы']
};

function genericFields(labels) {
  return labels.map(label => ({ key: label, label }));
}

const FIELD_LABEL_TRANSLATIONS = {
  'ФИО': { en: 'Full name', zh: '姓名', de: 'Vollständiger Name', tr: 'Ad Soyad', uz: 'F.I.Sh.', kk: 'Т.А.Ә.', ky: 'Аты-жөнү', ru: 'ФИО' },
  'Дата рождения': { en: 'Date of birth', zh: '出生日期', de: 'Geburtsdatum', tr: 'Doğum tarihi', uz: 'Tug‘ilgan sana', kk: 'Туған күні', ky: 'Туулган күнү', ru: 'Дата рождения' },
  'Дата выдачи': { en: 'Date of issue', zh: '签发日期', de: 'Ausstellungsdatum', tr: 'Veriliş tarihi', uz: 'Berilgan sana', kk: 'Берілген күні', ky: 'Берилген күнү', ru: 'Дата выдачи' },
  'Дата окончания': { en: 'Date of expiry', zh: '有效期至', de: 'Ablaufdatum', tr: 'Son kullanma tarihi', uz: 'Amal qilish muddati', kk: 'Жарамдылық мерзімі', ky: 'Жарактуулук мөөнөтү', ru: 'Дата окончания' },
  'Пол': { en: 'Sex', zh: '性别', de: 'Geschlecht', tr: 'Cinsiyet', uz: 'Jinsi', kk: 'Жынысы', ky: 'Жынысы', ru: 'Пол' },
  'Гражданство': { en: 'Citizenship', zh: '国籍', de: 'Staatsangehörigkeit', tr: 'Vatandaşlık', uz: 'Fuqaroligi', kk: 'Азаматтығы', ky: 'Жарандыгы', ru: 'Гражданство' },
  'Серия и номер': { en: 'Series and number', zh: '系列和号码', de: 'Serie und Nummer', tr: 'Seri ve numara', uz: 'Seriya va raqam', kk: 'Сериясы және нөмірі', ky: 'Сериясы жана номери', ru: 'Серия и номер' },
  'Орган выдачи': { en: 'Issuing authority', zh: '签发机关', de: 'Ausstellende Behörde', tr: 'Veren makam', uz: 'Bergan organ', kk: 'Берген орган', ky: 'Берген орган', ru: 'Орган выдачи' },
  'Страна': { en: 'Country', zh: '国家', de: 'Land', tr: 'Ülke', uz: 'Mamlakat', kk: 'Ел', ky: 'Өлкө', ru: 'Страна' },
  'Дата': { en: 'Date', zh: '日期', de: 'Datum', tr: 'Tarih', uz: 'Sana', kk: 'Күні', ky: 'Күнү', ru: 'Дата' },
  '№ апостиля': { en: 'Apostille No.', zh: '编号', de: 'Apostille-Nr.', tr: 'Apostil No.', uz: 'Apostil raqami', kk: 'Апостиль №', ky: 'Апостиль №', ru: '№ апостиля' }
  ,'Настоящий официальный документ': { en: 'This public document', zh: '本公文', de: 'Diese öffentliche Urkunde', tr: 'Bu resmi belge', uz: 'Ushbu rasmiy hujjat', kk: 'Осы ресми құжат', ky: 'Бул расмий документ', ru: 'Настоящий официальный документ' }
  ,'Подписан(а)': { en: 'Signed by', zh: '签署人', de: 'Unterzeichnet von', tr: 'İmzalayan', uz: 'Imzolagan', kk: 'Қол қойған', ky: 'Кол койгон', ru: 'Подписан(а)' }
  ,'Действующий(ая) в качестве': { en: 'Acting in the capacity of', zh: '身份/职务', de: 'Handelnd in der Eigenschaft als', tr: 'Şu sıfatla hareket eden', uz: 'Quyidagi lavozimda ish yurituvchi', kk: 'Мынадай қызметте әрекет етуші', ky: 'Төмөнкү сапатта иштеген', ru: 'Действующий(ая) в качестве' }
  ,'Скреплён печатью/штампом': { en: 'Bears the seal/stamp of', zh: '加盖的印章/印鉴', de: 'Versiegelt/gestempelt von', tr: 'Mühür/kaşe ile tasdikli', uz: 'Muhr/shtamp bilan tasdiqlangan', kk: 'Мөр/мөртабан басылған', ky: 'Мөөр/штамп менен бекитилген', ru: 'Скреплён печатью/штампом' }
  ,'Удостоверено в': { en: 'At', zh: '地点', de: 'Ort', tr: 'Yer', uz: 'Joy', kk: 'Орын', ky: 'Жери', ru: 'Удостоверено в' }
  ,'Удостоверено органом': { en: 'By', zh: '认证机关', de: 'Durch', tr: 'Tarafından', uz: 'Tasdiqlagan organ', kk: 'Куәландырған орган', ky: 'Күбөлөндүргөн орган', ru: 'Удостоверено органом' }
  ,'Удостоверено': { en: 'Certified', zh: '认证', ru: 'Удостоверено' }
  ,'Печать/штамп': { en: 'Seal/stamp', zh: '印章/印鉴', ru: 'Печать/штамп' }
  ,'Подпись': { en: 'Signature', zh: '签名', ru: 'Подпись' }
};

const NAME_LABEL = /ФИО|Фамилия|Имя|Отчество|Подписан|Подпис|Доверитель|Представитель|Сторона|Владелец|Плательщик|Получатель|печать\/подпись|seal|signature/i;
const PRESERVE_LABEL = /ПИН|ИНН|номер|сч[её]т|IBAN|VIN|дата|серия|БИК|апостил/i;
function isDateField(key, label) {
  return /date|дата/i.test(`${key} ${label}`);
}
function translatedFieldLabel(label, language) {
  return FIELD_LABEL_TRANSLATIONS[label]?.[language] || label;
}

function genericSchemaProperties() {
  return {
    fields: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          value: { type: 'STRING' },
          raw_text: { type: 'STRING' },
          page: { type: 'INTEGER' },
          confidence: { type: 'INTEGER' }
        },
        required: ['label', 'value', 'raw_text', 'page', 'confidence']
      }
    },
    // "Максимально сохранить структуру документа" (Ethan, 17 сен 2026) —
    // для "Другое" и любого клиентского типа без предопределённых полей
    // модель ДОПОЛНИТЕЛЬНО транскрибирует весь документ как упорядоченный
    // список абзацев/строк (см. buildCombinedInstruction), вместо того
    // чтобы сжимать всё в одно поле-заглушку. Для остальных (табличных)
    // типов остаётся пустым массивом — там всё нужное уже в полях.
    paragraphs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { text: { type: 'STRING' }, page: { type: 'INTEGER' } },
        required: ['text', 'page']
      }
    },
    elements: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' }, element_type: { type: 'STRING' },
          number: { type: 'STRING' }, label: { type: 'STRING' },
          value: { type: 'STRING' }, raw_text: { type: 'STRING' },
          page: { type: 'INTEGER' }, confidence: { type: 'INTEGER' }
        },
        required: ['key', 'element_type', 'number', 'label', 'value', 'raw_text', 'page', 'confidence']
      }
    }
  };
}

const TYPE_REGISTRY = Object.fromEntries([
  ['apostille', { label: 'Апостиль', fields: APOSTILLE_FIELDS, hint: 'an apostille certificate headed Apostille or Апостиль' }],
  ...DOC_TYPES.map(label => [label, {
    label,
    fields: genericFields(STANDARD_TRANSLATION_FIELDS[label] || ['Название документа', 'Номер', 'Дата', 'Прочий текст']),
    hint: `a document of type "${label}"`
  }])
]);

const APOSTILLE_COMPATIBILITY_KEYS = {
  certifying_authority: 'certifying_official',
  seal: 'seal_signature',
  signature: 'seal_signature'
};

const REGULATION_REGISTRY = {
  apostille: {
    code: 'HCCH_1961_APOSTILLE',
    title: 'Гаагская конвенция от 5 октября 1961 года',
    note: 'Апостиль подтверждает подпись, полномочия подписавшего и печать/штамп, но не заверяет перевод.'
  },
  'Паспорт / удостоверение личности': {
    code: 'DESTINATION_AUTHORITY_REQUIREMENTS',
    title: 'Требования принимающего органа',
    note: 'Проверьте требования страны назначения к переводу документа и транслитерации имени.'
  },
  'Свидетельство о рождении': {
    code: 'DESTINATION_AUTHORITY_REQUIREMENTS',
    title: 'Требования принимающего органа',
    note: 'Может потребоваться апостиль, консульская легализация или нотариальное заверение перевода.'
  },
  'Свидетельство о браке': {
    code: 'DESTINATION_AUTHORITY_REQUIREMENTS',
    title: 'Требования принимающего органа',
    note: 'Порядок легализации и заверения зависит от страны, куда подаётся документ.'
  },
  'Диплом / аттестат': {
    code: 'DESTINATION_EDUCATION_AUTHORITY_REQUIREMENTS',
    title: 'Требования учебного или государственного органа',
    note: 'Проверьте требования к академическим документам, апостилю и нотариальному переводу.'
  }
};

function regulationFor(docType) {
  return REGULATION_REGISTRY[docType] || {
    code: 'DESTINATION_AUTHORITY_REQUIREMENTS',
    title: 'Требования принимающего органа',
    note: 'Перед подачей проверьте требования страны назначения, включая легализацию и заверение перевода.'
  };
}

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

function buildCombinedInstruction(customTypes) {
  const types = { ...TYPE_REGISTRY };
  Object.entries(customTypes || {}).forEach(([label, entry]) => {
    types[label] = { label, fields: genericFields(Array.isArray(entry?.fields) && entry.fields.length ? entry.fields : []), hint: entry?.hint || `a custom document type "${label}"` };
  });
  const typeList = Object.entries(types).map(([key, type]) => `"${key}" (${type.hint})`).join('; ');
  const fieldMap = Object.fromEntries(Object.entries(types).map(([key, type]) => [key, type.fields.map(field => field.label)]));
  // "Максимально сохранить структуру документа, ничего не менять, но чтобы
  // всё переводилось" (Ethan, 17 сен 2026) — для "Другое" и ЛЮБОГО
  // клиентского типа (клиент мог не описать для него никаких полей вообще,
  // fieldMap[label] тогда пуст) фиксированный список полей не годится:
  // структура заранее неизвестна. Вместо того чтобы всё равно пытаться
  // впихнуть документ в поля (как раньше — единое поле-заглушка "Прочий
  // текст", которое стирало реальный порядок/разбивку на абзацы), модель
  // транскрибирует ВЕСЬ документ как есть, абзац за абзацем, в исходном
  // порядке — дальше это идёт в перевод и в экспорт тем же двухколоночным
  // "Оригинал | Перевод" рендером, что и обычный полный текст распознавания
  // (pairedLayoutBlocks в export.mjs — этот путь уже существовал, просто не
  // был подключён к новому пайплайну).
  const structuralTypes = ['Другое', ...Object.keys(customTypes || {})];
  return `Classify the document into exactly one of these types: ${typeList}. If the document contains the heading ` +
    '"APOSTILLE" or "Апостиль" and numbered Hague certificate fields, always choose "apostille", not "Другое". ' +
    'If none match, use "Другое". ' +
    `Then extract EVERY field for the selected type as an array of objects with label, value, raw_text, page and confidence. ` +
    `Use exactly these field labels from the selected type: ${JSON.stringify(fieldMap)}. ` +
    'Always return one object for every listed field in the selected type, in the same order; only value may be empty if genuinely absent. ' +
    `If the selected type is one of ${JSON.stringify(structuralTypes)}, ALSO transcribe the ENTIRE document as an ` +
    'ordered "paragraphs" array — every heading, paragraph, list item and line of text, in the original reading order, ' +
    'omitting and summarizing nothing, even content already captured by a field above. For every other (fixed-field) ' +
    'document type, leave "paragraphs" empty — the listed fields already capture what matters. ' +
    'Preserve names, numbers, dates, amounts and identifiers exactly. ' +
    'For dates use the printed form in value and raw_text. Never invent data. For apostille only: ' + buildApostilleExtractionInstruction();
}

function buildCombinedSchema() {
  return { doc_type: { type: 'STRING' }, ...genericSchemaProperties() };
}

// clientApiKey/clientSlug — ровно один может быть передан, тот же контракт,
// что у lib/accounting/pipeline.js:recognizeAccountingDocument
// (clientApiKey — x-api-key внешней интеграции через
// api/v1/translation-docs/recognize.js, clientSlug — клиент веб-панели
// через api/translation-docs/client-recognize.js). Оба ОТСУТСТВУЮТ, если
// вызывающий код их не передал — тогда квота НЕ проверяется (используется
// только внутренними тестами/скриптами, не публичными эндпоинтами).
async function recognizeAndTranslateDocument({ base64, mimeType, apiKey, language, clientApiKey, clientSlug, pageCount = 1 }) {
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
  let clientConfig = null;
  if (clientApiKey || clientSlug) {
    clientConfig = typeof getClientConfig === 'function'
      ? await getClientConfig({ apiKey: clientApiKey, clientSlug })
      : null;
    const units = Number.isInteger(pageCount) ? Math.max(1, Math.min(20, pageCount)) : 1;
    for (let unit = 0; unit < units; unit += 1) {
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
  }

  let response;
  try {
    response = await callGemini({
      apiKey,
      instruction: buildCombinedInstruction(clientConfig?.customDocTypes),
      mimeType,
      base64,
      schemaProperties: buildCombinedSchema(),
      requiredFields: ['doc_type', 'fields']
    });
  } catch (err) {
    if (err instanceof GeminiError) throw new TranslationDocError(err.message, err.status);
    throw err;
  }

  const rawResult = response.result;
  if (rawResult.__unparsed) {
    throw new TranslationDocError('Gemini вернула ответ не по схеме — повторите запрос', 502);
  }
  const rawDocType = rawResult.doc_type;
  const docType = /^(apostille|апостиль)$/i.test(String(rawDocType || '')) ? 'apostille' : rawDocType;
  const customEntry = clientConfig?.customDocTypes?.[docType];
  const typeDef = TYPE_REGISTRY[docType] || (customEntry ? {
    label: docType,
    fields: genericFields(Array.isArray(customEntry.fields) ? customEntry.fields : [])
  } : null);
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
  const { transliterateName, normalizeDate, apostilleValue, localizeMarkers } = await import('../../public/js/translation/field-rules.mjs');
  const { validateApostille } = await import('../../public/js/translation/apostille.mjs');
  const { splitText } = await import('../../public/js/translation/model.mjs');
  if (docType === 'apostille' && rawResult.elements?.length) validateApostille(rawResult.elements);
  const fieldsByKey = {};
  const segments = [];
  const extracted = Array.isArray(rawResult.fields)
    ? rawResult.fields
    : typeDef.fields.map(({ key, label }) => ({
      label,
      ...(rawResult[key] || rawResult[APOSTILLE_COMPATIBILITY_KEYS[key]] || {})
    }));
  const extractRaw = (key, label, index) =>
    (docType === 'apostille' && rawResult.elements?.find(e => e.key === key)) || extracted.find(field => field && field.label === label) || (docType !== 'apostille' ? extracted[index] : null) || {};

  // Глоссарий (lib/verifiedTransliterations.js — личный выбор клиента +
  // общий дефолт по большинству, см. TECH_DEBT.md/index.md 17 сен 2026):
  // спрашиваем ПЕРЕД авто-транслитерацией, а не вместо неё — если термина
  // в глоссарии нет, поведение как раньше (transliterateName/apostilleValue).
  // Только для языков с латиницей — ровно то же условие, что внутри
  // transliterateName(); запрос на других языках был бы бессмысленным.
  const LATIN_TARGET_LANGUAGES = new Set(['en', 'de', 'tr', 'uz', 'zh']);
  let glossaryMap = {};
  if (LATIN_TARGET_LANGUAGES.has(language)) {
    const candidateValues = [];
    for (const [index, { key, label }] of typeDef.fields.entries()) {
      const raw = extractRaw(key, label, index);
      const value = typeof raw.value === 'string' ? raw.value : '';
      if (!value.trim()) continue;
      const preserve = PRESERVE_LABEL.test(label) || /^[\d\s.,:/+()%-]+$/.test(value);
      const isApostilleName = docType === 'apostille' && ['signatory_name', 'signature'].includes(key);
      if ((NAME_LABEL.test(label) && !preserve) || isApostilleName) candidateValues.push(value);
    }
    if (candidateValues.length) {
      try {
        glossaryMap = await lookupTransliterations(usageClientRef, candidateValues);
      } catch (err) {
        // Тот же fail-safe принцип, что и у остальной аналитики/квоты —
        // недоступность глоссария никогда не должна ронять сам перевод.
        console.error('translationDocs: глоссарий недоступен —', err.message);
      }
    }
  }

  for (const [index, { key, label }] of typeDef.fields.entries()) {
    const raw = extractRaw(key, label, index);
    const value = typeof raw.value === 'string' ? raw.value : '';
    let fixed = docType === 'apostille' ? apostilleValue(key, value, language) : null;
    let fromGlossary = false;
    if (fixed && ['signatory_name', 'signature'].includes(key) && glossaryMap[value]) {
      fixed = { value: localizeMarkers(glossaryMap[value], language), status: 'transliterated' };
      fromGlossary = true;
    }
    const preserve = PRESERVE_LABEL.test(label) || /^[\d\s.,:/+()%-]+$/.test(value);
    const name = NAME_LABEL.test(label);
    const date = isDateField(key, label);
    const normalized = date ? normalizeDate(value) : value;
    if (!fixed && name && !preserve && glossaryMap[value]) fromGlossary = true;
    fieldsByKey[key] = {
      key,
      label,
      targetLabel: translatedFieldLabel(label, language),
      value,
      rawText: typeof raw.raw_text === 'string' ? raw.raw_text : '',
      confidence: Number.isFinite(raw.confidence) ? raw.confidence : 0,
      translated: fixed?.value ?? (date ? normalized : (preserve ? value : (name ? (glossaryMap[value] || transliterateName(value, language)) : ''))),
      translationStatus: fixed?.status ?? (date ? (normalized === value ? 'preserved' : 'translated') : (preserve ? 'preserved' : (name ? 'transliterated' : 'translated'))),
      // Значение подтверждено глоссарием (личным клиента или общим дефолтом
      // по большинству, см. lib/verifiedTransliterations.js) — намеренно
      // отличается от детерминированной transliterateName()/apostilleValue(),
      // поэтому validateApostille (public/js/translation/apostille.mjs) не
      // должен требовать точного совпадения для таких полей. Флаг переживает
      // весь путь fields → elements → экспорт (JSON, не пересчитывается).
      ...(fromGlossary ? { fromGlossary: true } : {})
    };
    if (value.trim() && (docType === 'apostille' ? !fixed : (!preserve && !name && !date))) segments.push({ id: `field_${index}`, key, text: value });
  }

  // "Максимально сохранить структуру документа, ничего не менять, но
  // переводить всё" (Ethan, 17 сен 2026) — для "Другое" и клиентских типов
  // Gemini дополнительно вернул rawResult.paragraphs (см. buildCombinedInstruction);
  // переводим их тем же батчингом/тем же translateSegments, что и поля, но
  // отдельно от fieldsByKey — итоговый порядок = порядок в документе,
  // ничего не пропущено и не переставлено. Один абзац может сам по себе
  // превышать лимит translateSegments (2000 символов на запрос) — режем его
  // через splitText (тот же алгоритм, что использовал старый /translate,
  // сохраняет каждый символ и пробел) на несколько сегментов-чанков и
  // склеиваем обратно по индексу чанка ПОСЛЕ того, как все батчи обработаны
  // (порядок прихода ответов от Gemini не гарантирован, порядок чанков в
  // массиве — гарантирован).
  const MAX_SEGMENT_CHARS = 1800;
  const paragraphsOut = [];
  const rawParagraphs = Array.isArray(rawResult.paragraphs) ? rawResult.paragraphs : [];
  rawParagraphs.forEach((p, i) => {
    const text = typeof p?.text === 'string' ? p.text : '';
    if (!text.trim()) return;
    const chunks = text.length > MAX_SEGMENT_CHARS ? splitText(text, MAX_SEGMENT_CHARS) : [text];
    const translatedChunks = new Array(chunks.length).fill('');
    const paraIndex = paragraphsOut.length;
    paragraphsOut.push({ text, translated: '', translatedChunks });
    chunks.forEach((chunk, chunkIndex) => {
      segments.push({ id: `para_${i}_${chunkIndex}`, isParagraph: true, paraIndex, chunkIndex, text: chunk });
    });
  });

  // Elements are the source of truth for apostille layout. Unlike fields, they
  // retain unnumbered headings and the number printed next to each field.
  let elements;
  if (docType === 'apostille') {
    const verificationUsage = await verifyApostilleValues({ fieldsByKey, apiKey, base64, mimeType });
    if (verificationUsage) {
      for (const key of ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount']) {
        const total = (response.usage?.[key] || 0) + (verificationUsage[key] || 0);
        response.usage = { ...response.usage, [key]: total };
      }
    }
    const sourceElements = Array.isArray(rawResult.elements) && rawResult.elements.length
      ? rawResult.elements
      : typeDef.fields.map(({ key, label, number, elementType }) => ({
        key, label, number: number || '', element_type: elementType || 'numbered_field',
        value: fieldsByKey[key]?.value || '', raw_text: fieldsByKey[key]?.rawText || '',
        page: 0, confidence: fieldsByKey[key]?.confidence || 0
      }));
    elements = sourceElements.map((element, index) => {
      const key = typeof element.key === 'string' ? element.key : `element_${index}`;
      const field = fieldsByKey[key];
      const value = typeof element.value === 'string' ? element.value : (field?.value || '');
      const label = field?.label || (typeof element.label === 'string' ? element.label : '');
      if (!field && element.element_type === 'stamp_text') {
        fieldsByKey[key] = { key, value, translated: '', targetLabel: '', label: '' };
        if (value.trim()) segments.push({ id: `stamp_${index}`, key, text: value });
      }
      const translated = field?.translated || '';
      return {
        key,
        elementType: element.element_type || 'section_text',
        number: element.number || '',
        label,
        targetLabel: translatedFieldLabel(label, language),
        value,
        translated,
        rawText: element.raw_text || field?.rawText || '',
        confidence: Number.isFinite(element.confidence) ? element.confidence : (field?.confidence || 0),
        ...(field?.fromGlossary ? { fromGlossary: true } : {}),
        ...(field?.fromLegalPhrase ? { fromLegalPhrase: true } : {}),
        ...(field?.legalPhraseNeedsReview ? { legalPhraseNeedsReview: true } : {})
      };
    });
  }

  if (segments.length) {
    // translateSegments deliberately limits one model request to 50 fragments
    // and 2000 characters. Split large documents without losing field order.
    const batches = [];
    let batch = [];
    let batchSize = 0;
    for (const segment of segments) {
      if (batch.length && (batch.length >= 50 || batchSize + segment.text.length > 2000)) {
        batches.push(batch);
        batch = [];
        batchSize = 0;
      }
      batch.push(segment);
      batchSize += segment.text.length;
    }
    if (batch.length) batches.push(batch);
    for (const current of batches) {
      const request = validateTranslationRequest({
        language,
        segments: current.map(({ id, text }) => ({ id, text }))
      });
      const { segments: translated } = await translateSegments(request, usageClientRef);
      for (const seg of translated) {
        const source = segments.find(item => item.id === seg.id);
        if (!source) continue;
        if (source.isParagraph) {
          paragraphsOut[source.paraIndex].translatedChunks[source.chunkIndex] = seg.text;
          continue;
        }
        if (fieldsByKey[source.key]) {
          fieldsByKey[source.key].translated = seg.text;
          // Сегмент подставлен целиком из словаря юридических клише
          // (lib/legalPhrases.js), а не переведён Gemini — тот же принцип
          // флага, что у fromGlossary (ФИО-глоссарий): переживает путь
          // fields → elements → экспорт, ничего не пересчитывается.
          if (seg.fromLegalPhrase) {
            fieldsByKey[source.key].fromLegalPhrase = true;
            if (seg.needsReview) fieldsByKey[source.key].legalPhraseNeedsReview = true;
          }
        }
      }
    }
  }
  // Склеиваем чанки каждого абзаца обратно в порядке чанков (не в порядке
  // прихода ответов от Gemini — translateSegments не гарантирует порядок
  // возврата, только полноту и соответствие id).
  paragraphsOut.forEach(p => { p.translated = p.translatedChunks.join(''); delete p.translatedChunks; });

  // Аналитика — тот же fail-safe принцип, что у lib/accounting/pipeline.js
  // (никогда не должна ронять сам ответ), только для платных клиентов Tamga.
  // docType здесь — конкретный тип документа ("apostille" и далее), не общий
  // "Перевод" — попадает в тот же разрез "По типам" в /admin, что и обычное
  // распознавание/бухгалтерия, отдельной строкой на каждый тип.
  if (elements) {
    elements.forEach(e => {
      const field = fieldsByKey[e.key];
      if (field) {
        e.translated = field.translated; e.sourceValue = field.value;
        e.requiresReview = field.requiresReview;
        e.reviewReason = field.reviewReason;
      }
    });
    validateApostille(elements, language, true, { allowPendingReview: true });
  }
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
    regulation: regulationFor(docType),
    fields: typeDef.fields.map(({ key }) => fieldsByKey[key]),
    paragraphs: paragraphsOut,
    ...(elements ? { elements } : {}),
    usage: response.usage
  };
}

module.exports = { recognizeAndTranslateDocument, TranslationDocError, TYPE_REGISTRY, REGULATION_REGISTRY };
