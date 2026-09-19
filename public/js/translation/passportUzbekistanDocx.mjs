// Рендерer .docx для типа "Паспорт Узбекистана (биометрический)" —
// современный биометрический паспорт (ICAO-страница с фото и MRZ),
// постепенно вытесняющий старый бумажный паспорт (отдельный тип, см.
// passportUzbekistanOldDocx.mjs). Вёрстка снята с РЕАЛЬНОГО перевода бюро
// ("шаблон паспорт узб.doc", прислан Ethan 19 сен 2026 — вторая из двух
// разных страниц в присланном файле).
//
// Как и у остальных типов — это НЕ буквальная склейка XML из присланного
// файла (там мусор ревизий/rsid и пять непоследовательно расставленных
// gridCol с несовпадающими у разных строк ширинами — похоже на артефакт
// ручного перетаскивания границ в Word бюро, а не осмысленную сетку), а
// вёрстка, написанная заново с теми же визуальными параметрами (шрифт,
// шкала ширин, границы), снятыми с самого образца.
//
// Структура образца — ОТЛИЧАЕТСЯ от passportCanadaDocx.mjs, хотя внешне
// похожа (фото + Тип/Код/Номер + личные данные + MRZ): у Канады все личные
// поля (Фамилия/Имя/Гражданство/...) идут ОДНИМ потоком абзацев "Лейбл:
// значение" внутри ОДНОЙ ячейки справа от фото. В узбекском образце —
// НАОБОРОТ: каждое поле своя строка ОТДЕЛЬНОЙ таблицы (лейбл и значение в
// РАЗНЫХ ячейках одной строки, не "Лейбл: значение" текстом), и то же
// верно для Тип/Код/Номер паспорта — это лейблы одной строки и значения
// строкой НИЖЕ (а не лейбл+жирное значение в одной ячейке, как у Канады).
// Раз реальный образец другой — вёрстка следует за ним, а не за уже
// принятой конвенцией соседнего файла.
//
//  - Заголовок "РЕСПУБЛИКА УЗБЕКИСТАН" на всю ширину (включая колонку фото)
//    — страна фиксирована в самой вёрстке, как КАНАДА у Канады; отдельного
//    поля country нет. Тонкая линия-разделитель под заголовком.
//  - Строка лейблов Тип / Код / Номер паспорта (3 колонки, каждая со своим
//    тонким разделителем слева) — над колонкой фото никакого лейбла нет,
//    только пустая ячейка той же ширины.
//  - Строка значений: фото-плейсхолдер + слово "ПАСПОРТ" (жирным, как у
//    Канады) в первой колонке (эта ячейка — начало вертикального
//    объединения w:vMerge на все нижеследующие строки личных данных), и
//    сами значения Тип/Код/Номер под своими лейблами.
//  - Далее построчно: Фамилия/Имя/Гражданство/Дата рождения/Место
//    рождения/Пол/Дата выдачи/Паспорт действителен до/Орган, выдавший
//    паспорт — каждое своя строка из ДВУХ ячеек (лейбл, значение), colспан
//    фото-колонки продолжается (w:vMerge continue). Разделитель — только
//    тонкая линия между фото-колонкой и колонкой лейбла; между лейблом и
//    значением в образце разделителя НЕТ (текст просто идёт друг за
//    другом).
//  - MRZ — последней строкой на всю ширину (без фото-колонки), ВОСПРОИЗВО-
//    ДИТСЯ как есть (поле в PRESERVE_LABEL, pipeline.js), только если
//    распознана — не рисуем пустую строку, если Gemini не смогла прочитать.
//  - Внешняя рамка всей таблицы — сплошная (образец использует "double" по
//    внешнему периметру, как и у старого паспорта того же комплекта).
import { certificationBlocks } from './export.mjs';
import { rFonts, createTextHelpers, cell, row, table } from './docxLayoutEngine.mjs';

const FONT = rFonts('Times New Roman');
const { run, para, paraRuns } = createTextHelpers(FONT);

// Ширины колонок (dxa) — сняты с образца и упрощены до двух согласованных
// раскладок одной и той же полной ширины (7620 = TYPE_COL+CODE_COL+NUM_COL
// = LABEL_COL+VALUE_COL): в образце пять по-разному подогнанных gridCol
// дают такую же сумму, но не выравниваются друг с другом построчно — не
// осмысленная сетка, а следствие ручного редактирования в Word бюро.
const PHOTO = 1951, TYPE_COL = 1985, CODE_COL = 2780, NUM_COL = 2855;
const LABEL_COL = 2977, VALUE_COL = 4643;
const TOTAL = PHOTO + TYPE_COL + CODE_COL + NUM_COL;
const THIN = { style: 'single', sz: 4 };

// Собственные копии констант (файлы вёрстки типов документов друг у друга
// общие константы не импортируют, см. комментарий в idCardDocx.mjs).
const COUNTRY_NAME = {
  ru: 'РЕСПУБЛИКА УЗБЕКИСТАН', ky: 'ӨЗБЕКСТАН РЕСПУБЛИКАСЫ', en: 'REPUBLIC OF UZBEKISTAN', kk: 'ӨЗБЕКСТАН РЕСПУБЛИКАСЫ',
  uz: 'OʻZBEKISTON RESPUBLIKASI', tr: 'ÖZBEKİSTAN CUMHURİYETİ', zh: '乌兹别克斯坦共和国', de: 'REPUBLIK USBEKISTAN'
};
const PASSPORT_WORD = {
  ru: 'ПАСПОРТ', ky: 'ПАСПОРТ', en: 'PASSPORT', kk: 'ПАСПОРТ',
  uz: 'PASPORT', tr: 'PASAPORT', zh: '护照', de: 'REISEPASS'
};
const PHOTO_PLACEHOLDER = {
  ru: '/ФОТО ВЛАДЕЛЬЦА/', ky: '/КАРТ ЭЭСИНИН СҮРӨТҮ/', en: '/PHOTO OF THE HOLDER/', kk: '/ИЕСІНІҢ СУРЕТІ/',
  uz: '/EGASINING FOTOSI/', tr: '/SAHİBİNİN FOTOĞRAFI/', zh: '/持有人照片/', de: '/FOTO DES INHABERS/'
};

function labelPara(field) {
  return field?.label ? para(field.label) : para('');
}
function valuePara(field) {
  return field?.value ? para(field.value, { bold: true }) : para('');
}

// translation — то же самое, что у остальных типов: language, fields[]
// (уже переведённые label+value). certification — то же, что принимает
// certificationBlocks().
export function buildPassportUzbekistanDocumentXml(translation, certification) {
  const lang = translation.language;
  const fields = translation.fields || [];
  const map = Object.fromEntries(fields.filter(f => f.key).map(f => [f.key, f]));
  const countryText = COUNTRY_NAME[lang] || COUNTRY_NAME.en;
  const passportWord = PASSPORT_WORD[lang] || PASSPORT_WORD.en;
  const photoLabel = PHOTO_PLACEHOLDER[lang] || PHOTO_PLACEHOLDER.en;

  // --- шапка: страна на всю ширину, тонкая линия-разделитель снизу.
  const headerRow = row(cell(TOTAL, para(countryText, { align: 'center', bold: true, size: 26 }), { span: 4, borders: ['bottom'], borderOpts: THIN }));

  // --- строка лейблов Тип / Код / Номер паспорта — пустая ячейка над
  // фотоколонкой, три лейбла с тонким разделителем слева от каждого.
  const typeCodeNumLabelsRow = row(
    cell(PHOTO, para('')) +
    cell(TYPE_COL, labelPara(map.passportType), { borders: ['left'], borderOpts: THIN }) +
    cell(CODE_COL, labelPara(map.code), { borders: ['left'], borderOpts: THIN }) +
    cell(NUM_COL, labelPara(map.passportNumber), { borders: ['left'], borderOpts: THIN })
  );

  // --- строка значений: фото+"ПАСПОРТ" (начало w:vMerge), значения
  // Тип/Код/Номер под своими лейблами.
  const photoCellXml = para(passportWord, { bold: true, size: 28 }) + para('') + para('') + para(photoLabel, { italic: true, align: 'center' });
  const typeCodeNumValuesRow = row(
    `<w:tc><w:tcPr><w:tcW w:w="${PHOTO}" w:type="dxa"/><w:vMerge w:val="restart"/><w:vAlign w:val="center"/></w:tcPr>${photoCellXml}</w:tc>` +
    cell(TYPE_COL, valuePara(map.passportType), { borders: ['left'], borderOpts: THIN }) +
    cell(CODE_COL, valuePara(map.code), { borders: ['left'], borderOpts: THIN }) +
    cell(NUM_COL, valuePara(map.passportNumber), { borders: ['left'], borderOpts: THIN })
  );

  // --- личные данные: каждое поле своя строка (лейбл | значение),
  // фотоколонка продолжает вертикальное объединение (w:vMerge continue).
  // Только непустые — частично распознанный документ не показывает пустые
  // подписанные строки.
  const bioFieldsList = [map.surname, map.givenName, map.citizenship, map.birthDate, map.birthPlace, map.gender, map.issueDate, map.expiryDate, map.issuingAuthority];
  const bioRows = bioFieldsList
    .filter(field => field?.value)
    .map(field =>
      `<w:tc><w:tcPr><w:tcW w:w="${PHOTO}" w:type="dxa"/><w:vMerge/></w:tcPr><w:p/></w:tc>` +
      cell(LABEL_COL, labelPara(field), { borders: ['left'], borderOpts: THIN }) +
      cell(VALUE_COL, valuePara(field))
    )
    .map(cellsXml => row(cellsXml))
    .join('');

  // --- MRZ — воспроизводится как есть (поле помечено в PRESERVE_LABEL,
  // pipeline.js, и транскрибируется посимвольно по инструкции в
  // buildCombinedInstruction), только если распознана. Без фотоколонки —
  // на всю ширину, как в образце.
  const mrzRow = map.mrz?.value
    ? row(cell(TOTAL, para('') + para(map.mrz.value, { bold: true }), { span: 4 }))
    : '';

  const body = headerRow + typeCodeNumLabelsRow + typeCodeNumValuesRow + bioRows + mrzRow;
  const tableXml = table([PHOTO, TYPE_COL, CODE_COL, NUM_COL], body, { borderStyle: 'double', sides: ['top', 'left', 'bottom', 'right'] });

  const certParas = certificationBlocks(certification, lang).map(b => para(b.text, { size: 20 })).join('');
  const documentBody = tableXml + certParas;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + documentBody + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
