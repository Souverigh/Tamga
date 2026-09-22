// Рендерer .docx для типа "Паспорт Канады" — отдельная вёрстка (не вариант
// общей "Паспорт / удостоверение личности" в idCardDocx.mjs), снятая с
// РЕАЛЬНОГО перевода бюро ("Паспорт Канада.docx", прислан Ethan 19 сен
// 2026): страница-разворот ICAO-паспорта со строкой Тип/Код/Номер паспорта,
// фотоблоком, персональными данными и MRZ, плюс отдельная опциональная
// страница "Оговорки и ограничения" (эндорсемент-страница с подписью
// владельца, которую бюро в образце тоже перевело).
//
// Как и у Аттестата/ID-карты — это НЕ буквальная склейка XML из присланного
// файла (там мусор ревизий/rsid), а вёрстка, написанная заново с теми же
// визуальными параметрами (шрифт, ширины колонок, размеры границ), снятыми
// с самого образца.
//
// Отличия от буквального образца (сознательные):
//  - В образце справа от обоих блоков идёт узкая колонка с серийным номером
//    страницы паспорта, повёрнутым на 90° ("ELZ 97532", поле pageSerialNumber,
//    documentStructures.js) — раньше (18 сен 2026) это поле сознательно НЕ
//    воспроизводилось как не несущее переводимой информации; Ethan, 19 сен
//    2026, на реальном скане показал, что оно ВСЁ-ТАКИ должно извлекаться и
//    попадать в перевод — решение пересмотрено. Само вращение текста на 90°
//    не воспроизводится (тот же принцип, что и у QR-плейсхолдеров в других
//    типах — визуальный поворот не несёт переводимых данных), значение
//    просто добавлено обычной строкой в блок личных данных ниже. В образце
//    код у обоих блоков (основная страница / страница "Оговорки") может быть
//    РАЗНЫЙ — сейчас показывается только один раз (значение с основной
//    страницы); если это окажется важным, отдельное поле под страницу
//    "Оговорки" — следующий шаг.
//  - Все внутренние границы — сплошные sz4 (в образце местами намешаны
//    sz4/sz12 без видимой системы, похоже на артефакты редактирования в
//    Word) — только внешняя рамка обоих блоков toлщиной sz12, как и в
//    остальных внешних границах образца.
//  - Фотоблок — как в idCardDocx.mjs, единый плейсхолдер "/ФОТО ВЛАДЕЛЬЦА/"
//    курсивом по центру (та же дефолт-конвенция placeholder'ов, что и для
//    подписи), а не три отдельных строки "Фото/владельца/паспорта" как в
//    образце — единообразие с уже принятой конвенцией важнее точной копии.
//  - Блок "Оговорки и ограничения" показан ПОСЛЕ основной страницы с
//    персональными данными (а не до неё, как в порядке страниц образца) —
//    личные данные владельца это основной результат перевода, эндорсемент-
//    страница — дополнение к нему.
//  - Страна ("КАНАДА") и слово "ПАСПОРТ" в шапке — фиксированные
//    (переведённые локально, не через поля): тип документа по определению
//    всегда "паспорт Канады", поле под них было бы лишним (см.
//    documentStructures.js).
//  - Блок "Оговорки и ограничения" рисуется, только если поле
//    restrictionsText распознано (страница-эндорсемент была среди
//    присланных) — не подставляем шаблонный текст, если её не было.
import { certificationBlocks } from './export.mjs';
import { rFonts, createTextHelpers, cell, row, table } from './docxLayoutEngine.mjs';

const FONT = rFonts('Times New Roman');
const { run, para, paraRuns } = createTextHelpers(FONT);

// Ширины колонок основной таблицы (dxa) — сняты с образца (2974/4162/1864,
// округлены до ровных чисел, чтобы первая колонка совпадала в обеих
// строках, где в образце она сама плавала между 2974/3000).
const TYPE_COL = 2600, CODE_COL = 2600, NUM_COL = 3800;
const TOTAL = TYPE_COL + CODE_COL + NUM_COL;
const LABEL_COL = TYPE_COL, DATA_COL = CODE_COL + NUM_COL;
const THIN = { style: 'single', sz: 4 };

const COUNTRY_NAME = {
  ru: 'КАНАДА', ky: 'КАНАДА', en: 'CANADA', kk: 'КАНАДА',
  uz: 'KANADA', tr: 'KANADA', zh: '加拿大', de: 'KANADA',
  it: 'CANADA', es: 'CANADÁ'
};
const PASSPORT_WORD = {
  ru: 'ПАСПОРТ', ky: 'ПАСПОРТ', en: 'PASSPORT', kk: 'ПАСПОРТ',
  uz: 'PASPORT', tr: 'PASAPORT', zh: '护照', de: 'REISEPASS',
  it: 'PASSAPORTO', es: 'PASAPORTE'
};
// Тот же плейсхолдер-конвент, что и в idCardDocx.mjs (own copy — файлы
// вёрстки типов документов друг у друга общие константы не импортируют,
// см. комментарий там же).
const PHOTO_PLACEHOLDER = {
  ru: '/ФОТО ВЛАДЕЛЬЦА/', ky: '/КАРТ ЭЭСИНИН СҮРӨТҮ/', en: '/PHOTO OF THE HOLDER/', kk: '/ИЕСІНІҢ СУРЕТІ/',
  uz: '/EGASINING FOTOSI/', tr: '/SAHİBİNİN FOTOĞRAFI/', zh: '/持有人照片/', de: '/FOTO DES INHABERS/',
  it: '/FOTO DEL TITOLARE/', es: '/FOTO DEL TITULAR/'
};
const SIGNATURE_PLACEHOLDER = {
  ru: '/подпись/', ky: '/кол коюлган/', en: '/signature/', kk: '/қолы/',
  uz: '/imzo/', tr: '/imza/', zh: '/签名/', de: '/Unterschrift/',
  it: '/firma/', es: '/firma/'
};
const OWNER_SIGNATURE_LABEL = {
  ru: 'Подпись владельца', ky: 'Ээсинин колу', en: "Holder's signature", kk: 'Иесінің қолы',
  uz: 'Egasining imzosi', tr: 'Sahibinin imzası', zh: '持有人签名', de: 'Unterschrift des Inhabers',
  it: 'Firma del titolare', es: 'Firma del titular'
};

function fieldLine(field) {
  if (!field?.value) return '';
  return paraRuns(run(`${field.label}: `) + run(field.value, { bold: true }));
}

// Тип/Код/Номер паспорта в образце — лейбл и значение на ДВУХ отдельных
// строках (значение жирным), а не "Лейбл: значение" в одну строку, как у
// остальных полей — см. саму XML образца.
function stackedField(field) {
  if (!field?.value) return para('');
  return para(field.label) + para(field.value, { bold: true });
}

// translation — то же самое, что у Аттестата/ID-карты: language, fields[]
// (уже переведённые label+value). certification — то же, что принимает
// certificationBlocks().
export function buildPassportCanadaDocumentXml(translation, certification) {
  const lang = translation.language;
  const fields = translation.fields || [];
  const map = Object.fromEntries(fields.filter(f => f.key).map(f => [f.key, f]));

  const countryText = COUNTRY_NAME[lang] || COUNTRY_NAME.en;
  const passportWord = PASSPORT_WORD[lang] || PASSPORT_WORD.en;
  const photoLabel = PHOTO_PLACEHOLDER[lang] || PHOTO_PLACEHOLDER.en;
  const sigLabel = SIGNATURE_PLACEHOLDER[lang] || SIGNATURE_PLACEHOLDER.en;
  const ownerSigLabel = OWNER_SIGNATURE_LABEL[lang] || OWNER_SIGNATURE_LABEL.en;

  // --- шапка: название страны на всю ширину, жирным, крупнее обычного
  // текста (13pt, как в образце), с тонким разделителем снизу.
  const headerRow = row(cell(TOTAL, para(countryText, { align: 'center', bold: true, size: 26 }), { span: 3, borders: ['bottom'], borderOpts: THIN }));

  // --- Тип / Код / Номер паспорта.
  const typeCodeNumRow = row(
    cell(TYPE_COL, stackedField(map.passportType), { borders: ['right', 'bottom'], borderOpts: THIN }) +
    cell(CODE_COL, stackedField(map.code), { borders: ['left', 'right', 'bottom'], borderOpts: THIN }) +
    cell(NUM_COL, stackedField(map.passportNumber), { borders: ['left', 'bottom'], borderOpts: THIN })
  );

  // --- фотоблок + личные данные (Фамилия/Имя/Гражданство/Дата рождения/
  // Место рождения/Пол/Дата выдачи/Действителен до/Орган выдавший) — только
  // непустые, чтобы частично распознанный документ не показывал пустые
  // строки "Поле: ".
  const photoCellXml = para(passportWord, { bold: true, size: 28 }) + para('') + para('') + para(photoLabel, { italic: true, align: 'center' });
  const bioFields = [map.surname, map.givenName, map.citizenship, map.birthDate, map.birthPlace, map.gender, map.issueDate, map.expiryDate, map.issuingAuthority, map.pageSerialNumber]
    .map(fieldLine)
    .filter(Boolean)
    .join('');
  const bioRow = row(
    cell(LABEL_COL, photoCellXml, { borders: ['right', 'bottom'], borderOpts: THIN }) +
    cell(DATA_COL, bioFields || para(''), { span: 2, borders: ['left', 'bottom'], borderOpts: THIN })
  );

  // --- MRZ — как и в idCardDocx.mjs, воспроизводится как есть (поле
  // помечено в PRESERVE_LABEL, pipeline.js, и транскрибируется посимвольно
  // по инструкции в buildCombinedInstruction), только если распознана —
  // не рисуем пустую строку, если Gemini её не смогла прочитать.
  const mrzRow = map.mrz?.value
    ? row(cell(TOTAL, para('') + para(map.mrz.value), { span: 3, borders: ['top'], borderOpts: THIN }))
    : '';

  const mainTableXml = table([TYPE_COL, CODE_COL, NUM_COL], headerRow + typeCodeNumRow + bioRow + mrzRow, { borderSz: 12, sides: ['top', 'left', 'bottom', 'right'] });

  // --- "Оговорки и ограничения" — страница-эндорсемент с подписью
  // владельца (см. комментарий в шапке файла). Рисуется только если поле
  // распознано, то есть эта страница была среди присланных.
  let restrictionsXml = '';
  if (map.restrictionsText?.value) {
    const numberValue = map.passportNumber?.value || '';
    const restrictionsBody =
      para(map.restrictionsText.label, { align: 'center', bold: true }) +
      para('') +
      para(map.restrictionsText.value) +
      para('') +
      para(sigLabel, { italic: true }) +
      paraRuns(run(`${ownerSigLabel}     `) + (numberValue ? run(numberValue, { bold: true }) : ''));
    restrictionsXml = table([TOTAL], row(cell(TOTAL, restrictionsBody)), { borderSz: 12, sides: ['top', 'left', 'bottom', 'right'] });
  }

  const certParas = certificationBlocks(certification, lang).map(b => para(b.text, { size: 20 })).join('');
  const documentBody = mainTableXml + (restrictionsXml ? para('') + restrictionsXml : '') + certParas;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + documentBody + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
