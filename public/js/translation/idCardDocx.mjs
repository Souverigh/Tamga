// Рендерer .docx для типа "Паспорт / удостоверение личности" (ID-карта КР
// и аналогичные документы личности — см. documentStructures.js).
//
// В отличие от первой версии этого файла, теперь есть РЕАЛЬНЫЙ перевод от
// бюро ("шаблон айди.docx", прислан Ethan 19 сен 2026) — вёрстка ниже
// повторяет его структуру теми же параметрами (шрифт, размеры границ,
// ширины колонок 264/2278/3270/3813 и 4991/4634), сняты с самого файла,
// тем же приёмом, что и у Аттестата: не буквальная склейка чужого XML
// (там служебный мусор ревизий/rsid), а разметка, написанная заново с теми
// же визуальными параметрами.
//
// Структура реального образца:
//  - Таблица 1: шапка (страна + вид документа), фотоблок слева
//    (вертикально объединённая ячейка на все строки блока личных данных —
//    w:vMerge), справа построчно Фамилия/Имя/Отчество/Пол, затем
//    Гражданство (во всю ширину — в образце подписано "Nationality", но
//    рядом отдельно есть настоящая Ethnicity, поэтому здесь оставлен более
//    точный лейбл "Гражданство"/"Citizenship" самого поля citizenship, не
//    буквальная копия подписи бюро — см. FIELD_LABEL_TRANSLATIONS), затем
//    Дата рождения + Номер документа в одной строке, /Подпись/ + Дата
//    окончания в следующей.
//  - Таблица 2: Место рождения + Персональный номер (ПИН), Орган выдачи +
//    номер документа ещё раз крупным шрифтом (как на самой карте — бюро
//    в образце дублирует номер документа так же), Дата выдачи +
//    Национальность (этническая принадлежность) в одной ячейке, и MRZ
//    строкой на всю ширину внизу — жирным Times New Roman, выравнивание
//    по ширине, 3 строки через перенос, как в образце.
//  - MRZ ВОСПРОИЗВОДИТСЯ (подтверждено Ethan через AskUserQuestion 19 сен
//    2026, после того как реальный образец показал, что бюро её не
//    опускает) — поле mrz помечено в PRESERVE_LABEL (pipeline.js), поэтому
//    не уходит на перевод вторым вызовом Gemini, только распознаётся один
//    раз и выводится как есть.
//  - Семейное положение и адрес проживания в реальном образце НЕ показаны
//    вовсе (бюро их не включает в перевод ID-карты) — но раз Ethan просил
//    их распознавать, они не теряются: если значение есть, попадают
//    отдельной мини-таблицей после основных двух, а не пропадают молча.
import { certificationBlocks } from './export.mjs';
import { rFonts, createTextHelpers, cell, row, table } from './docxLayoutEngine.mjs';

const FONT = rFonts('Times New Roman');
const { run, para, paraRuns, LINE_BREAK } = createTextHelpers(FONT);

// Таблица 1 — колонки сняты с образца: декоративная полоса, фотоблок,
// левая и правая инфо-колонки.
const DECOR = 264, PHOTO = 2278, INFO_L = 3270, INFO_R = 3813;
const TABLE1_TOTAL = DECOR + PHOTO + INFO_L + INFO_R;
// Таблица 2 — те же две колонки, что и в образце.
const COL_A = 4991, COL_B = 4634;

const PHOTO_PLACEHOLDER = {
  ru: '/ФОТО ВЛАДЕЛЬЦА/', ky: '/КАРТ ЭЭСИНИН СҮРӨТҮ/', en: '/PHOTO OF THE HOLDER/', kk: '/ИЕСІНІҢ СУРЕТІ/',
  uz: '/EGASINING FOTOSI/', tr: '/SAHİBİNİN FOTOĞRAFI/', zh: '/持有人照片/', de: '/FOTO DES INHABERS/'
};
const SIGNATURE_PLACEHOLDER = {
  ru: '/подпись/', ky: '/кол коюлган/', en: '/signature/', kk: '/қолы/',
  uz: '/imzo/', tr: '/imza/', zh: '/签名/', de: '/Unterschrift/'
};
// Статический заголовок на случай, если Gemini не смог извлечь documentType
// (например часть образца оказалась нечитаемой) — country само по себе уже
// делает шапку не привязанной жёстко к Кыргызстану (тот же приём, что и в
// Аттестате с полем country).
const FALLBACK_TITLE = {
  ru: 'Документ, удостоверяющий личность', ky: 'Инсандыкты тастыктоочу документ', en: 'Identity document',
  kk: 'Жеке басын куәландыратын құжат', uz: 'Shaxsni tasdiqlovchi hujjat', tr: 'Kimlik belgesi',
  zh: '身份证件', de: 'Personaldokument'
};

// Декоративная полоса + фотоблок слева от инфо-строки — вертикально
// объединяются через w:vMerge на все строки личных данных, как в образце.
const decorPhotoCell = (vMergeAttr, contentXml) =>
  `<w:tc><w:tcPr><w:tcW w:w="${DECOR}" w:type="dxa"/><w:vMerge${vMergeAttr}/></w:tcPr><w:p/></w:tc>` +
  `<w:tc><w:tcPr><w:tcW w:w="${PHOTO}" w:type="dxa"/><w:vMerge${vMergeAttr}/><w:vAlign w:val="center"/></w:tcPr>${contentXml || '<w:p/>'}</w:tc>`;

function fieldLine(field) {
  if (!field?.value) return '';
  return paraRuns(run(`${field.label}: `) + run(field.value, { bold: true }));
}

// translation — как и для остальных типов: language, fields[] (уже
// переведённые label+value, ключи как в STANDARD_TRANSLATION_FIELDS этого
// типа в documentStructures.js). certification — то же, что принимает
// certificationBlocks().
export function buildIdCardDocumentXml(translation, certification) {
  const lang = translation.language;
  const fields = translation.fields || [];
  const map = Object.fromEntries(fields.filter(f => f.key).map(f => [f.key, f]));
  const photoLabel = PHOTO_PLACEHOLDER[lang] || PHOTO_PLACEHOLDER.en;
  const sigLabel = SIGNATURE_PLACEHOLDER[lang] || SIGNATURE_PLACEHOLDER.en;

  // --- шапка: страна + вид документа (оба поля опциональны — не любой
  // документ этого типа их распознаёт), иначе статический общий заголовок.
  const titleParts = [map.country?.value, map.documentType?.value].filter(Boolean);
  const titleText = titleParts.length ? titleParts.join('\n') : (FALLBACK_TITLE[lang] || FALLBACK_TITLE.en);
  const headerRow = row(cell(TABLE1_TOTAL, para(titleText, { align: 'center', bold: true, size: 24 }), { span: 4 }), { height: 560 });

  // --- личные данные: фотоблок слева (одна вертикально объединённая
  // ячейка — w:vMerge — на все строки этого блока), Фамилия/Имя/Отчество/
  // Пол по одному в строке, Гражданство на всю ширину, Дата рождения +
  // Номер документа, /Подпись/ + Дата окончания. Каждый элемент rows —
  // это уже готовые XML двух инфо-ячеек (без декор/фотоблока), decor+photo
  // приклеивается один раз при сборке строк ниже, с vMerge restart на
  // первой и continue на остальных.
  const photoXml = para(photoLabel, { italic: true, align: 'center' });
  const rows = [];
  [map.surname, map.givenName, map.patronymic, map.gender].forEach(field => {
    if (field?.value) rows.push(cell(INFO_L, fieldLine(field)) + cell(INFO_R, para('')));
  });
  if (map.citizenship?.value) rows.push(cell(INFO_L + INFO_R, fieldLine(map.citizenship), { span: 2 }));
  if (map.birthDate?.value || map.documentNumber?.value) {
    rows.push(cell(INFO_L, fieldLine(map.birthDate) || para('')) + cell(INFO_R, fieldLine(map.documentNumber) || para('')));
  }
  if (map.expiryDate?.value) {
    rows.push(cell(INFO_L, paraRuns(run(sigLabel, { bold: true }))) + cell(INFO_R, fieldLine(map.expiryDate)));
  }

  let table1Body = headerRow;
  rows.forEach((cellsXml, i) => {
    const decor = decorPhotoCell(i === 0 ? ' w:val="restart"' : '', i === 0 ? photoXml : null);
    table1Body += row(decor + cellsXml);
  });

  const table1Xml = table([DECOR, PHOTO, INFO_L, INFO_R], table1Body, { sides: ['top', 'left', 'bottom', 'right'] });

  // --- вторая таблица: место рождения + ПИН, орган выдачи + номер
  // документа (крупно, как на самой карте — образец дублирует его так же),
  // дата выдачи + этническая принадлежность, MRZ на всю ширину.
  const row1 = row(
    cell(COL_A, fieldLine(map.birthPlace) || para('')) +
    cell(COL_B, fieldLine(map.taxId) || para(''))
  );
  const row2 = row(
    cell(COL_A, fieldLine(map.issuingAuthority) || para('')) +
    cell(COL_B, map.documentNumber?.value ? para(map.documentNumber.value, { bold: true, size: 24 }) : para(''))
  );
  const row3Left = [fieldLine(map.issueDate), fieldLine(map.ethnicity)].filter(Boolean).join('');
  const row3 = row(
    cell(COL_A, row3Left || para('')) +
    cell(COL_B, para(''))
  );
  const mrzRow = map.mrz?.value
    ? row(cell(COL_A + COL_B, para(map.mrz.value, { bold: true, align: 'both', size: 24 }), { span: 2 }))
    : '';
  const table2Body = row1 + row2 + row3 + mrzRow;
  const table2Xml = table([COL_A, COL_B], table2Body, { sides: ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] });

  // --- поля, для которых в реальном образце нет места (бюро их просто не
  // включает в перевод ID-карты), но Ethan просил их распознавать — не
  // теряются, показываются отдельной мини-таблицей, если есть значение.
  const extra = [map.maritalStatus, map.address].filter(f => f?.value);
  const extraTable = extra.length
    ? table([COL_A, COL_B], extra.map(f => row(
        cell(COL_A, para(f.label, { bold: true }), { borders: ['top', 'bottom', 'right'] }) +
        cell(COL_B, para(f.value), { borders: ['top', 'left', 'bottom'] })
      )).join(''))
    : '';

  const certParas = certificationBlocks(certification, lang).map(b => para(b.text, { size: 20 })).join('');
  const documentBody = table1Xml + para('') + table2Xml + (extraTable ? para('') + extraTable : '') + certParas;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + documentBody + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
