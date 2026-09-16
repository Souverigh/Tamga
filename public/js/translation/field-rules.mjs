// Shared source-to-output rules for recognition, review and export validation.
const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: 'ie', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia', ң: 'ng', ү: 'u', ө: 'o' };
export function transliterateName(value, language) {
  if (!['en', 'de', 'tr', 'uz', 'zh'].includes(language)) return value;
  return Array.from(String(value)).map(char => {
    const lower = char.toLowerCase();
    const mapped = TRANSLIT[lower];
    if (mapped === undefined) return char;
    return char === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }).join('');
}
export function normalizeDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return `${match[3].padStart(2, '0')}-${match[2].padStart(2, '0')}-${match[1].slice(-2)}`;
  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:\s*-?\s*(?:ж\.?|г\.?))?$/i);
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 31 && Number(match[2]) >= 1 && Number(match[2]) <= 12) return `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}-${match[3].slice(-2)}`;
  return text;
}

export function localizeMarkers(value, language) {
  const markers = {
    zh: ['【印章】', '【签字】'], en: ['[seal]', '[signature]'],
    ru: ['[печать]', '[подпись]'], ky: ['[мөөр]', '[кол тамга]'],
    kk: ['[мөр]', '[қолтаңба]'], de: ['[Siegel]', '[Unterschrift]'],
    tr: ['[mühür]', '[imza]'], uz: ['[muhr]', '[imzo]']
  }[language] || ['[seal]', '[signature]'];
  return value.replace(/\[seal\]/gi, markers[0]).replace(/\[signature\]/gi, markers[1]);
}

// null means the content needs translation. Names/dates/IDs never go to an LLM.
export function apostilleValue(key, source, language) {
  let value;
  let status = 'preserved';
  if (['signatory_name', 'signature'].includes(key)) {
    const name = transliterateName(source, language);
    value = localizeMarkers(name, language);
    status = name !== source ? 'transliterated' : (value !== source ? 'translated' : 'preserved');
  } else if (key === 'certified_date') {
    value = normalizeDate(source);
    status = value !== source ? 'translated' : 'preserved';
  } else if (key === 'apostille_number' || ['public_document', 'certified'].includes(key)) {
    value = source;
  } else if (key === 'seal' && /^\s*\[seal\]\s*$/i.test(source)) {
    value = localizeMarkers(source, language);
    status = value !== source ? 'translated' : 'preserved';
  } else return null;
  return { value, status };
}

export const TRANSLATION_STATUSES = {
  translated: ['Перевод', '#18794e'],
  transliterated: ['Транслитерация', '#7c3aed'],
  preserved: ['Без изменений', '#64748b']
};
