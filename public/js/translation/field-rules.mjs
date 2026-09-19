// Shared source-to-output rules for recognition, review and export validation.
// ң/ү/ө — киргизские кириллические буквы. ў/қ/ғ/ҳ — узбекские кириллические
// буквы (документы на узбекской кириллице, напр. "Паспорт Узбекистана
// (старого образца)"/"(биометрический)", добавлены 19 сен 2026: не были в
// таблице вовсе, из-за этого ФИО с этими буквами транслитерировались бы
// частично — буква проходила бы как есть внутри иначе латинского имени).
// Соответствие латинскому узбекскому алфавиту: ў→oʻ, қ→q, ғ→gʻ, ҳ→h — тот
// же уровень строгости, что у ky ң/ү/ө (практическое соответствие, не
// сверено с носителем, см. TECH_DEBT.md).
const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: 'ie', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia', ң: 'ng', ү: 'u', ө: 'o', ў: 'oʻ', қ: 'q', ғ: 'gʻ', ҳ: 'h' };
const CYRILLIC_TARGET_LANGUAGES = ['ru', 'ky', 'kk'];
const LATIN_TARGET_LANGUAGES = ['en', 'de', 'tr', 'uz', 'zh'];

// Обратное направление (латиница → кириллица) — нужно, когда исходный
// документ уже на латинице (иностранный, напр. канадский паспорт), а язык
// перевода кириллический (ru/ky/kk). Практическая транскрипция по звучанию,
// НЕ лингвистически строгая система — английская орфография неоднозначна
// (th/w/c и т.п. не имеют единого кириллического соответствия), проверено
// на типичных именах, вычитка носителем не проводилась — тот же уровень
// строгости, что у ky ң/ү/ө в обратную сторону (см. TECH_DEBT.md), добавлена
// туда же запись 19 сен 2026.
const LATIN_DIGRAPHS = [
  ['tch', 'ч'], ['sch', 'ш'],
  ['ch', 'ч'], ['sh', 'ш'], ['ph', 'ф'], ['th', 'т'], ['kh', 'х'], ['gh', 'г'], ['ck', 'к'], ['qu', 'кв'], ['wh', 'у'],
  ['oo', 'у'], ['ee', 'и'], ['ou', 'у'],
  ['ya', 'я'], ['ja', 'я'], ['yu', 'ю'], ['ju', 'ю'], ['yo', 'ё'], ['jo', 'ё'],
  ['ay', 'ай'], ['ai', 'ай'], ['ey', 'ей'], ['ei', 'ей'], ['oy', 'ой'], ['oi', 'ой']
];
const LATIN_SINGLE = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к', l: 'л', m: 'м',
  n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'и', z: 'з'
};
function transliterateLatinWord(word) {
  if (!/[a-zà-ÿ]/i.test(word)) return word; // не буквенный токен (пробел, дефис) — как есть
  const isUpper = word === word.toUpperCase() && word !== word.toLowerCase();
  const isTitle = /^[A-ZÀ-Ÿ]/.test(word) && !isUpper;
  // немое конечное "h" после гласной: Sarah -> Сара, а не Сарах
  const lower = word.toLowerCase().replace(/([aeiouy])h$/, '$1');
  let out = '';
  for (let i = 0; i < lower.length; ) {
    const rest = lower.slice(i);
    const digraph = LATIN_DIGRAPHS.find(([lat]) => rest.startsWith(lat));
    if (digraph) { out += digraph[1]; i += digraph[0].length; continue; }
    const single = LATIN_SINGLE[lower[i]];
    out += single !== undefined ? single : lower[i];
    i += 1;
  }
  if (isUpper) return out.toUpperCase();
  if (isTitle) return out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}
const transliterateLatinToCyrillic = value => String(value).split(/(\s+)/).map(transliterateLatinWord).join('');

export function transliterateName(value, language) {
  const text = String(value ?? '');
  const hasCyrillic = /[а-яёңүөўқғҳ]/i.test(text);
  const hasLatin = /[a-zà-ÿ]/i.test(text);
  if (hasCyrillic && LATIN_TARGET_LANGUAGES.includes(language)) {
    return Array.from(text).map(char => {
      const lower = char.toLowerCase();
      const mapped = TRANSLIT[lower];
      if (mapped === undefined) return char;
      return char === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    }).join('');
  }
  // Исходное имя уже на латинице (иностранный документ, напр. канадский
  // паспорт) — раньше просто возвращалось как есть на ЛЮБОЙ нелатинский
  // целевой язык (Ethan, 19 сен 2026, живой кейс: MARTIN/SARAH не
  // переводились при экспорте на русский).
  if (hasLatin && !hasCyrillic && CYRILLIC_TARGET_LANGUAGES.includes(language)) {
    return transliterateLatinToCyrillic(text);
  }
  return text;
}
// Английские сокращения месяцев (3 буквы) — двуязычные канадские (и другие
// билингвальные) документы печатают дату как "01 AUG/AOÛT 1990"
// (день, месяц на двух языках через "/", год) — распознаём по АНГЛИЙСКОЙ
// части (она первой перед "/"), французскую сторону игнорируем, т.к. она
// не нужна, если английское сокращение уже однозначно определяет месяц.
const MONTH_ABBR = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
export function normalizeDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return `${match[3].padStart(2, '0')}-${match[2].padStart(2, '0')}-${match[1].slice(-2)}`;
  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:\s*-?\s*(?:ж\.?|г\.?))?$/i);
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 31 && Number(match[2]) >= 1 && Number(match[2]) <= 12) return `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}-${match[3].slice(-2)}`;
  // "01 AUG/AOÛT 1990" или "14 JAN/JAN 2023" — день, англ. (возможно с
  // французской парой через "/") сокращение месяца, год (19 сен 2026,
  // добавлено для канадского паспорта — Ethan заметил, что дата так и
  // осталась в исходном виде вместо ДД-ММ-ГГ).
  match = text.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})(?:\s*\/\s*[A-Za-zÀ-ÿ.]+)?\s+(\d{4})$/);
  if (match) {
    const month = MONTH_ABBR[match[2].slice(0, 3).toUpperCase()];
    if (month) return `${match[1].padStart(2, '0')}-${String(month).padStart(2, '0')}-${match[3].slice(-2)}`;
  }
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
