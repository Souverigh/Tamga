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
  { key: 'country', label: 'Страна' },
  { key: 'signatory_name', label: 'Документ подписан(а)' },
  { key: 'signatory_capacity', label: 'Действующим в качестве' },
  { key: 'seal_authority', label: 'Скреплён печатью/штампом' },
  { key: 'certified_place', label: 'Удостоверено в' },
  { key: 'certified_date', label: 'Числа' },
  { key: 'certifying_official', label: 'Уполномоченным лицом/органом' },
  { key: 'apostille_number', label: '№ апостиля' },
  { key: 'registry_number', label: '№ в реестре' },
  { key: 'additional_notes', label: 'Прочие примечания' }
];

function apostilleSchemaProperties() {
  const properties = {};
  for (const { key } of APOSTILLE_FIELDS) properties[key] = PROVENANCE_FIELD_SCHEMA;
  return properties;
}

function buildApostilleExtractionInstruction() {
  return 'Extract structured data from this apostille (a Hague Convention 1961 certificate authenticating a public ' +
    'document — standardly a numbered stamp or page with about 10 fields, often headed "Apostille" or "Апостиль"). ' +
    'The document may be in Russian, Kyrgyz, English or another language. Extract: the country of issue ("country", ' +
    'field 1 — "This public document has been signed by..."), the name of the person who signed the underlying ' +
    'document ("signatory_name", field 2), the capacity in which they acted ("signatory_capacity", field 3, e.g. ' +
    '"нотариус"/"notary"), the authority whose seal or stamp the underlying document bears ("seal_authority", field ' +
    '4), the place of certification ("certified_place", field 5), the date of certification ("certified_date", field ' +
    '6, format YYYY-MM-DD if determinable, otherwise transcribe as printed), the authority or official who issued ' +
    'the apostille itself ("certifying_official", field 7), the apostille\'s own number ("apostille_number", field ' +
    '8), any separate registry number if shown ("registry_number", often "зарегистрировано под №..."), and any other ' +
    'significant printed text that does not fit the fields above ("additional_notes"). If a field is genuinely ' +
    'absent, set its "value" to an empty string and "confidence" to 0 — never invent a value that is not indicated ' +
    'anywhere on the document. For "raw_text", transcribe the value exactly as printed, unformatted. Rate confidence ' +
    '0-100 for every field using how complete and unambiguous the printed source is — a clearly printed, unambiguous ' +
    'value should score above 90. Every field must be reported as an object with "value", "raw_text", "page" ' +
    '(1-indexed page this value was read from), and "confidence" — never as a bare value.';
}

module.exports = { APOSTILLE_FIELDS, apostilleSchemaProperties, buildApostilleExtractionInstruction };
