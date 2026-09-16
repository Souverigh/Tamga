// Схема полей апостиля — первый тип документа в новом модуле "Перевод"
// (Ethan, 16 сен 2026: "то же самое [что бухгалтерия] для перевода —
// отдельная загрузка, общий лимит страниц с распознаванием, плюс апостиль и
// другие типы документов"). Тот же provenance-приём {value, raw_text, page,
// confidence}, что у lib/accounting/extraction.js — НЕ импортируется оттуда
// (свой отдельный периметр файлов, тот же принцип, что у
// lib/accounting/apiKeyAuth.js отдельно от lib/apiKeyAuth.js), схема просто
// скопирована в том же виде ради совместимости с уже работающим приёмом.
//
// Апостиль — международный сертификат по Гаагской конвенции 1961 года,
// стандартно ~10 пронумерованных полей (страна/подписант/должность/печать/
// место/дата/удостоверяющий орган/номер/номер в реестре). Это НЕ
// бухгалтерский документ — нет построчной таблицы и нет движка бизнес-правил
// (rules/engine.js), только извлечение полей; дальше их переводит
// lib/translation.js:translateSegments (та же функция и та же гарантия
// "перевод не меняет числа/суммы", что раньше использовал прежний экран
// public/js/translation/panel.js).

const PROVENANCE_FIELD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    value: { type: 'STRING' },
    raw_text: { type: 'STRING' },
    page: { type: 'INTEGER' },
    confidence: { type: 'INTEGER' }
  },
  required: ['value', 'raw_text', 'page', 'confidence']
};

const APOSTILLE_FIELDS = [
  { key: 'country', label: 'Страна', number: '1' },
  { key: 'public_document', label: 'Настоящий официальный документ', elementType: 'section_text' },
  { key: 'signatory_name', label: 'Подписан(а)', number: '2' },
  { key: 'signatory_capacity', label: 'Действующий(ая) в качестве', number: '3' },
  { key: 'seal_authority', label: 'Скреплён печатью/штампом', number: '4' },
  { key: 'certified', label: 'Удостоверено', elementType: 'section_text' },
  { key: 'certified_place', label: 'Удостоверено в', number: '5' },
  { key: 'certified_date', label: 'Дата', number: '6' },
  { key: 'certifying_authority', label: 'Удостоверено органом', number: '7' },
  { key: 'apostille_number', label: '№ апостиля', number: '8' },
  { key: 'seal', label: 'Печать/штамп', number: '9' },
  { key: 'signature', label: 'Подпись', number: '10' }
];

const APOSTILLE_ELEMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    key: { type: 'STRING' },
    element_type: { type: 'STRING', enum: ['numbered_field', 'section_text', 'stamp_text'] },
    number: { type: 'STRING' },
    label: { type: 'STRING' },
    value: { type: 'STRING' },
    raw_text: { type: 'STRING' },
    page: { type: 'INTEGER' },
    confidence: { type: 'INTEGER' }
  },
  required: ['key', 'element_type', 'number', 'label', 'value', 'raw_text', 'page', 'confidence']
};

function apostilleSchemaProperties() {
  const properties = {};
  for (const { key } of APOSTILLE_FIELDS) properties[key] = PROVENANCE_FIELD_SCHEMA;
  return { ...properties, elements: { type: 'ARRAY', items: APOSTILLE_ELEMENT_SCHEMA } };
}

function buildApostilleExtractionInstruction() {
  return 'Extract structured data from this apostille (a Hague Convention 1961 certificate authenticating a public ' +
    'document with exactly 10 numbered fields, headed "Apostille" or "Апостиль"). ' +
    'Use these exact element keys in order: country, public_document, signatory_name, signatory_capacity, seal_authority, certified, certified_place, certified_date, certifying_authority, apostille_number, seal, signature. ' +
    'Never number the two section headings; never create fields 11 or 12 or merge seal and signature. ' +
    'Names and initials are data: copy every character exactly, never transliterate or normalize. Preserve dates and identifiers exactly. For uncertain characters use [unclear], never guess. ' +
    'Before returning, visually re-check each initial and digit against the image. Never complete a familiar surname from memory. ' +
    'Confidence describes the least certain character in a field, not how plausible the whole value sounds. If any character is uncertain, use confidence below 90 and mark that character [unclear]. ' +
    'In seal use [seal] only if a graphical seal exists; in signature preserve any printed name exactly and append [signature] only if a graphical signature exists. Put readable stamp text in a separate unnumbered stamp_text element with a unique key and an empty label. Section heading values must be empty; their text belongs in label. Do not put additional text in signature as a catch-all. ' +
    'The document may be in Russian, Kyrgyz, English or another language. Preserve the visible structure: field 1 is ' +
    'country; the unnumbered heading "This public document" comes before fields 2-4; fields 2-4 are signed by, acting ' +
    'in the capacity of, and bears the seal/stamp of; the unnumbered heading "Certified" comes before fields 5-10; ' +
    'fields 5-10 are at, date, by, no., seal/stamp, and signature. ' +
    'Return an ordered "elements" array that preserves the visual structure exactly. Use element_type "numbered_field" ' +
    'only when the original visibly has a number, and use "section_text" for unnumbered lines such as "This public document" ' +
    'and "Certified". Never invent or renumber numbers. Keep seal and signature as separate elements. If a graphical ' +
    'seal or signature is present, use "[印章]" or "[签字]" only in the translated value; never generate a new signature. If a field is ' +
    'genuinely ' +
    'absent, set its "value" to an empty string and "confidence" to 0 — never invent a value that is not indicated ' +
    'anywhere on the document. For "raw_text", transcribe the value exactly as printed, unformatted. Rate confidence ' +
    '0-100 for every field using how complete and unambiguous the printed source is — a clearly printed, unambiguous ' +
    'value should score above 90. Every field must be reported as an object with "value", "raw_text", "page" ' +
    '(1-indexed page this value was read from), and "confidence" — never as a bare value.';
}

module.exports = { APOSTILLE_FIELDS, apostilleSchemaProperties, buildApostilleExtractionInstruction };
