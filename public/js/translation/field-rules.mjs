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
// Названия месяцев словом на языках исходных документов (Ethan, 20 сен 2026,
// живой кейс: в свидетельстве о рождении "27 января 1991 года" и "24 апреля
// 2012 г." оставались как есть — ни один числовой паттерн ниже их не
// матчил). Ищем по началу слова, в нижнем регистре: покрывает падежные формы
// ("января"/"январь"/"январе") без перечисления каждой. Порядок важен только
// для коротких основ, которые являются началом других: "мам" (казахский май)
// не должен ловиться как "мар" (март) — у них разные первые три буквы, так
// что конфликтов по трём буквам нет; "май"/"мая" (русский/кыргызский) и
// "may" (узбекский) сравниваются целиком.
const MONTH_NAME_STEMS = [
  // ru / ky
  ['янв', 1], ['фев', 2], ['мар', 3], ['апр', 4], ['мая', 5], ['май', 5], ['июн', 6], ['июл', 7], ['авг', 8], ['сен', 9], ['окт', 10], ['ноя', 11], ['дек', 12],
  // kk
  ['қаң', 1], ['ақп', 2], ['нау', 3], ['сәу', 4], ['мам', 5], ['мау', 6], ['шіл', 7], ['там', 8], ['қыр', 9], ['қаз', 10], ['қар', 11], ['жел', 12],
  // uz (латиница)
  ['yan', 1], ['fev', 2], ['apr', 4], ['iyun', 6], ['iyul', 7], ['avg', 8], ['sen', 9], ['okt', 10], ['noy', 11], ['dek', 12]
];
function monthFromName(word) {
  const w = String(word || '').toLowerCase();
  if (w === 'may') return 5;
  if (w === 'mart') return 3;
  const hit = MONTH_NAME_STEMS.find(([stem]) => w.startsWith(stem));
  return hit ? hit[1] : 0;
}
// Год всегда четырьмя цифрами (Ethan, 20 сен 2026: "для всех дат ДД-ММ-ГГГГ").
// Двузначный год ("79" в канадском паспорте, "30/01/18") разворачиваем по
// окну: не дальше 10 лет вперёд от текущего года — 20xx (срок действия
// документа), иначе 19xx (дата рождения). Окно, а не фиксированный век:
// у даты рождения "79" это 1979, у срока действия "35" — 2035.
function fullYear(value) {
  const digits = String(value);
  if (digits.length >= 4) return digits.slice(-4);
  const yy = Number(digits);
  const limit = (new Date().getFullYear() + 10) % 100;
  return String((yy <= limit ? 2000 : 1900) + yy);
}
export function normalizeDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return `${match[3].padStart(2, '0')}-${match[2].padStart(2, '0')}-${fullYear(match[1])}`;
  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:\s*-?\s*(?:ж\.?|г\.?))?$/i);
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 31 && Number(match[2]) >= 1 && Number(match[2]) <= 12) return `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}-${fullYear(match[3])}`;
  // Год бывает и двузначным: канадский паспорт печатает дату рождения как
  // "05 MAY /MAI 79" (Ethan, 20 сен 2026, живой кейс — дата не форматировалась,
  // шаблон требовал четыре цифры года).
  // "01 AUG/AOÛT 1990" или "14 JAN/JAN 2023" — день, англ. (возможно с
  // французской парой через "/") сокращение месяца, год (19 сен 2026,
  // добавлено для канадского паспорта — Ethan заметил, что дата так и
  // осталась в исходном виде вместо ДД-ММ-ГГГГ).
  match = text.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})(?:\s*\/\s*[A-Za-zÀ-ÿ.]+)?\s+(\d{4}|\d{2})$/);
  if (match) {
    const month = MONTH_ABBR[match[2].slice(0, 3).toUpperCase()];
    if (month) return `${match[1].padStart(2, '0')}-${String(month).padStart(2, '0')}-${fullYear(match[3])}`;
  }
  // "June 30, 2026" — американский порядок (месяц словом, день, запятая,
  // год), а не "30 Jun 2026" как выше (Ethan, 19 сен 2026: электронная
  // справка КР на английском отдаёт "Дата и время формирования документа"
  // и "Дата подписи" именно так — ни один паттерн выше не матчил, дата
  // оставалась непереведённой). MONTH_ABBR ищем по первым 3 буквам — работает
  // и для полного "June", и для сокращения "Jun".
  match = text.match(/^([A-Za-zÀ-ÿ]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) {
    const month = MONTH_ABBR[match[1].slice(0, 3).toUpperCase()];
    if (month) return `${match[2].padStart(2, '0')}-${String(month).padStart(2, '0')}-${fullYear(match[3])}`;
  }
  // Дата с "хвостом" (время, часовой пояс, "года"/"жылы"/"г."/"ж.") — ни один
  // из паттернов выше не матчит ЦЕЛИКОМ такую строку, и дата раньше уходила
  // непереведённой (Ethan, 19 сен 2026: электронная справка КР отдаёт "Дата и
  // время формирования документа" как "30-06-2026 года, 10:49:39 (GMT+6)").
  // Находим саму дату где угодно в строке, переводим её в ДД-ММ-ГГГГ, слово
  // "года"/"жылы"/"г."/"ж." сразу после даты убираем как избыточное (уже не
  // нужно при цифровом формате), а остальной хвост (время, часовой пояс)
  // сохраняем как есть — тот же принцип и для docx, и для PDF/фото, т.к.
  // normalizeDate вызывается уже после извлечения текста, одинаково для всех
  // источников (см. isDateField в lib/translationDocs/pipeline.js).
  const stripTail = (index, length) => text.slice(index + length).replace(/^[\s-]*(?:года|жылы|г\.|ж\.)\s*,?\s*/i, ' ').trim();
  // "27 января 1991 года", "24 апреля 2012 г.", "27-январь 1991-ж.", "27 қаңтар
  // 1991 ж.", "27 yanvar 1991" — день, месяц словом (ru/ky/kk/uz), год.
  match = text.match(/(\d{1,2})[\s-]+(\p{L}{3,})\.?,?\s+(\d{4})/u);
  if (match) {
    const month = monthFromName(match[2]);
    if (month) {
      const normalized = `${match[1].padStart(2, '0')}-${String(month).padStart(2, '0')}-${fullYear(match[3])}`;
      const rest = stripTail(match.index, match[0].length);
      return rest ? `${normalized}, ${rest}` : normalized;
    }
  }
  match = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    const normalized = `${match[3].padStart(2, '0')}-${match[2].padStart(2, '0')}-${fullYear(match[1])}`;
    const rest = stripTail(match.index, match[0].length);
    return rest ? `${normalized}, ${rest}` : normalized;
  }
  match = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})/);
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 31 && Number(match[2]) >= 1 && Number(match[2]) <= 12) {
    const normalized = `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}-${fullYear(match[3])}`;
    const rest = stripTail(match.index, match[0].length);
    return rest ? `${normalized}, ${rest}` : normalized;
  }
  // "June 30, 2026, 10:49:39 (GMT+6)" — тот же случай, что и "MONTH DD,
  // YYYY" выше, но с хвостом времени/часового пояса после года.
  match = text.match(/([A-Za-zÀ-ÿ]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (match) {
    const month = MONTH_ABBR[match[1].slice(0, 3).toUpperCase()];
    if (month) {
      const normalized = `${match[2].padStart(2, '0')}-${String(month).padStart(2, '0')}-${fullYear(match[3])}`;
      const rest = stripTail(match.index, match[0].length).replace(/^,\s*/, '');
      return rest ? `${normalized}, ${rest}` : normalized;
    }
  }
  return text;
}

// Третий маркер — [qr] (Ethan, 19 сен 2026: "печати, подписи, QR-коды —
// нужно так же указывать и обрабатывать, как мы уже сделали для подписей").
// Тот же принцип: графический элемент, который бессмысленно транскрибировать
// как текст — модель просто отмечает его наличие, а перевод подставляет
// готовую подпись-плейсхолдер на нужном языке.
export function localizeMarkers(value, language) {
  const markers = {
    zh: ['【印章】', '【签字】', '【二维码】'], en: ['[seal]', '[signature]', '[QR code]'],
    ru: ['[печать]', '[подпись]', '[QR-код]'], ky: ['[мөөр]', '[кол тамга]', '[QR-код]'],
    kk: ['[мөр]', '[қолтаңба]', '[QR-код]'], de: ['[Siegel]', '[Unterschrift]', '[QR-Code]'],
    tr: ['[mühür]', '[imza]', '[QR kodu]'], uz: ['[muhr]', '[imzo]', '[QR-kod]']
  }[language] || ['[seal]', '[signature]', '[QR code]'];
  return value.replace(/\[seal\]/gi, markers[0]).replace(/\[signature\]/gi, markers[1]).replace(/\[qr\]/gi, markers[2]);
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
