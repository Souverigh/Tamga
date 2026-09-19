// Рендерer .docx для типа "Паспорт Узбекистана (старого образца)" — паспорт
// гражданина Республики Узбекистан советского буклетного образца, который
// постепенно вытесняется биометрическим паспортом (отдельный тип, см.
// passportUzbekistanDocx.mjs). Вёрстка снята с РЕАЛЬНОГО перевода бюро
// ("шаблон паспорт узб.doc", прислан Ethan 19 сен 2026 — первая из двух
// разных страниц в присланном файле; вторая — биометрический паспорт).
//
// Как и у Аттестата/ID-карты/Паспорта Канады — это НЕ буквальная склейка
// XML из присланного файла (там мусор ревизий/rsid Word), а вёрстка,
// написанная заново с теми же визуальными параметрами (шрифт, ширины
// колонок, размеры и стили границ), снятыми с самого образца.
//
// Структура образца:
//  - Заголовок "РЕСПУБЛИКА УЗБЕКИСТАН" на всю ширину — страна фиксирована в
//    самой вёрстке (как КАНАДА в passportCanadaDocx.mjs), отдельного поля
//    country нет: тип документа по определению всегда этот паспорт.
//  - Каждое поле — ОТДЕЛЬНАЯ строка таблицы, лейбл и значение — два абзаца
//    внутри одной ячейки (лейбл обычным начертанием, значение жирным) — тот
//    же приём stackedField, что у Тип/Код/Номер в passportCanadaDocx.mjs, а
//    НЕ "Лейбл: значение" в одну строку, как у fieldLine() в остальных
//    типах. Порядок строк как в образце: Фамилия (левая колонка), Пол
//    (правая колонка — своя отдельная строка ниже; из-за маленькой высоты
//    строк в оригинале выглядит почти на одном уровне с Фамилией, но
//    структурно это следующая строка таблицы), Имя, Отчество, Дата рождения
//    (левая) + Место рождения (правая, объединены на 2 колонки) в одной
//    строке, Национальность, Кем выдан (на всю ширину).
//  - Внутренние вертикальные разделители в образце — тонкие сплошные линии
//    ТОЛЬКО в двух местах: между средней (пустой) и правой колонкой в
//    строке "Пол", и между "Дата рождения" и "Место рождения". Везде
//    больше — без границ (беcрамочная сетка). Внешняя рамка всей таблицы —
//    сплошная ДВОЙНАЯ линия (образец: w:val="double" по периметру).
//  - "ПОДПИСЬ ВЛАДЕЛЬЦА" + плейсхолдер подписи — всегда в конце, как
//    постоянный структурный элемент бланка (не поле, извлекаемое из
//    документа) — тот же приём, что и фото-плейсхолдер в других типах.
//  - Поля, которых у этого типа нет вовсе (Гражданство, номер документа,
//    даты выдачи/окончания, адрес, MRZ и т.п.) — их поддерживает только
//    биометрический тип, см. passportUzbekistanDocx.mjs.
import { certificationBlocks } from './export.mjs';
import { rFonts, createTextHelpers, cell, row, table } from './docxLayoutEngine.mjs';

const FONT = rFonts('Times New Roman');
const { run, para, paraRuns } = createTextHelpers(FONT);

// Ширины колонок — сняты с образца.
const COL1 = 3045, COL2 = 3135, COL3 = 3391;
const TOTAL = COL1 + COL2 + COL3;
const THIN = { style: 'single', sz: 4 };

// Страна фиксирована — своя копия константы (файлы вёрстки типов
// документов друг у друга общие константы не импортируют, см. комментарий
// в idCardDocx.mjs).
const COUNTRY_NAME = {
  ru: 'РЕСПУБЛИКА УЗБЕКИСТАН', ky: 'ӨЗБЕКСТАН РЕСПУБЛИКАСЫ', en: 'REPUBLIC OF UZBEKISTAN', kk: 'ӨЗБЕКСТАН РЕСПУБЛИКАСЫ',
  uz: 'OʻZBEKISTON RESPUBLIKASI', tr: 'ÖZBEKİSTAN CUMHURİYETİ', zh: '乌兹别克斯坦共和国', de: 'REPUBLIK USBEKISTAN'
};
const SIGNATURE_TITLE = {
  ru: 'ПОДПИСЬ ВЛАДЕЛЬЦА', ky: 'КАРТ ЭЭСИНИН КОЛУ', en: "HOLDER'S SIGNATURE", kk: 'ИЕСІНІҢ ҚОЛЫ',
  uz: 'EGASINING IMZOSI', tr: 'SAHİBİNİN İMZASI', zh: '持证人签名', de: 'UNTERSCHRIFT DES INHABERS'
};
const SIGNATURE_PLACEHOLDER = {
  ru: '/подпись/', ky: '/кол коюлган/', en: '/signature/', kk: '/қолы/',
  uz: '/imzo/', tr: '/imza/', zh: '/签名/', de: '/Unterschrift/'
};

// Лейбл обычным начертанием, значение жирным — двумя абзацами внутри одной
// ячейки, как в образце (не "Лейбл: значение" в одну строку).
function stackedField(field) {
  if (!field?.value) return null;
  return para(field.label) + para(field.value, { bold: true });
}

// translation — как и для остальных типов: language, fields[] (уже
// переведённые label+value, ключи как в STANDARD_TRANSLATION_FIELDS этого
// типа в documentStructures.js). certification — то же, что принимает
// certificationBlocks().
export function buildPassportUzbekistanOldDocumentXml(translation, certification) {
  const lang = translation.language;
  const fields = translation.fields || [];
  const map = Object.fromEntries(fields.filter(f => f.key).map(f => [f.key, f]));
  const countryText = COUNTRY_NAME[lang] || COUNTRY_NAME.en;
  const sigTitle = SIGNATURE_TITLE[lang] || SIGNATURE_TITLE.en;
  const sigPlaceholder = SIGNATURE_PLACEHOLDER[lang] || SIGNATURE_PLACEHOLDER.en;

  const headerRow = row(cell(TOTAL, para(countryText, { align: 'center', bold: true, size: 24 }), { span: 3 }), { height: 500 });

  // --- поля: каждое своей строкой, непустые (частично распознанный
  // документ не должен показывать пустые подписанные строки).
  const rows = [];

  const surname = stackedField(map.surname);
  if (surname) rows.push(cell(COL1, surname) + cell(COL2, para('')) + cell(COL3, para('')));

  const gender = stackedField(map.gender);
  if (gender) {
    rows.push(
      cell(COL1, para('')) +
      cell(COL2, para(''), { borders: ['right'], borderOpts: THIN }) +
      cell(COL3, gender, { borders: ['left'], borderOpts: THIN })
    );
  }

  const givenName = stackedField(map.givenName);
  if (givenName) rows.push(cell(COL1, givenName) + cell(COL2, para('')) + cell(COL3, para('')));

  const patronymic = stackedField(map.patronymic);
  if (patronymic) rows.push(cell(COL1, patronymic) + cell(COL2, para('')) + cell(COL3, para('')));

  const birthDate = stackedField(map.birthDate);
  const birthPlace = stackedField(map.birthPlace);
  if (birthDate || birthPlace) {
    rows.push(
      cell(COL1, birthDate || para(''), { borders: ['right'], borderOpts: THIN }) +
      cell(COL2 + COL3, birthPlace || para(''), { span: 2, borders: ['left'], borderOpts: THIN })
    );
  }

  const ethnicity = stackedField(map.ethnicity);
  if (ethnicity) rows.push(cell(COL1, ethnicity) + cell(COL2, para('')) + cell(COL3, para('')));

  const issuingAuthority = stackedField(map.issuingAuthority);
  if (issuingAuthority) rows.push(cell(TOTAL, issuingAuthority, { span: 3 }));

  let body = headerRow;
  rows.forEach(cellsXml => { body += row(cellsXml); });

  // --- отступ + подпись владельца — постоянный структурный элемент бланка
  // (как фото-плейсхолдер в других типах), а не поле документа.
  body += row(cell(TOTAL, para(''), { span: 3 }), { height: 100 });
  const signatureXml = para(sigTitle) + paraRuns(run('     ') + run(sigPlaceholder, { italic: true }));
  body += row(cell(TOTAL, signatureXml, { span: 3 }));

  const tableXml = table([COL1, COL2, COL3], body, { borderStyle: 'double', sides: ['top', 'left', 'bottom', 'right'] });

  const certParas = certificationBlocks(certification, lang).map(b => para(b.text, { size: 20 })).join('');
  const documentBody = tableXml + certParas;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + documentBody + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
