// Специальный рендерer .docx для Аттестата — в отличие от остальных типов
// документов (которые собираются универсальными helper'ами paragraph()/
// table() из export.mjs, шрифт Arial, сплошные рамки), этот файл повторяет
// РЕАЛЬНУЮ вёрстку настоящего переведённого аттестата ("аттестат 9.docx",
// бюро SILK ROAD TRANSLATION, прислан Ethan 18 сен 2026): шрифт Times New
// Roman, пунктирные (dashed) рамки у таблиц предметов/экзаменов — это и есть
// тот самый "вид как в Word-документе", который нужен для перевода
// аттестатов, а не общий рендер, разработанный для остальных типов.
//
// Технически это НЕ буквальный кусок XML из присланного файла: реальный
// .docx полон служебного мусора (проверка орфографии режет "Abubakirov
// Sultanbek Almazbekovich" на три отдельных <w:r>, id ревизий и т.п.),
// поэтому вместо хрупкой посимвольной склейки чужого XML эта вёрстка
// написана заново, теми же самыми параметрами (шрифт, размеры границ,
// ширины колонок 5055/3810, пунктир dashed sz=4), которые были сняты с
// реального файла — результат выглядит так же, но не рискует сломаться на
// разрезанных Word'ом рантах.
//
// Отличия от буквального оригинала (сознательные, по просьбе Ethan, 18 сен
// 2026):
//  - Таблица не "плавающая" (tblpPr), а обычная — в документе больше нечему
//    обтекать её текстом, разница не видна, а обычная таблица надёжнее.
//  - Разное число предметов/экзаменов не ломает вёрстку: строки таблицы
//    строятся по фактическому количеству записей в translation.tables, а
//    не копируют ровно 21+6 строк исходного примера.
//  - Страна в шапке ({{country}}) — не захардкожена как "Kyrgyz Republic":
//    берётся из распознанного поля, чтобы аттестаты из других стран тоже
//    читались корректно.
//  - Подписи директора/завуча/классного руководителя показывают реальное
//    распознанное имя, если оно есть, иначе — маркер "/подпись/" на языке
//    экспорта (тем же способом, что и в реальном образце).
//  - Приписка бюро переводов внизу — это уже существующий certificationBlocks()
//    из export.mjs (см. его комментарий):两 абзаца, язык перевода первым,
//    язык оригинала вторым. В настоящем образце этот блок набран другим
//    шрифтом (Garamond, ~9pt) — здесь оставлен Times New Roman чуть мельче,
//    чтобы не заводить третий шрифт ради одной детали; можно поправить
//    отдельно, если понадобится точь-в-точь.
import { escapeXml, certificationBlocks, ATTESTAT_LABELS, TABLE_LABELS } from './export.mjs';

const FONT = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="SimSun"/>';
const COL1 = 5055, COL2 = 3810, TOTAL = COL1 + COL2;
const SIG_COL1 = 3802, SIG_COL2 = 1502;

// "/подпись/"-конвенция бюро переводов: маркер вместо неразборчивой или
// отсутствующей рукописной подписи (см. сам образец — там тоже "/signature/"
// вместо реальных имён директора/завуча/классного руководителя).
const SIGNATURE_PLACEHOLDER = {
  ru: '/подпись/', ky: '/кол коюлган/', en: '/signature/', kk: '/қолы/',
  uz: '/imzo/', tr: '/imza/', zh: '/签名/', de: '/Unterschrift/'
};

const run = (text, { bold, italic, size } = {}) => {
  const rPr = FONT + (bold ? '<w:b/><w:bCs/>' : '') + (italic ? '<w:i/><w:iCs/>' : '') + (size ? `<w:sz w:val="${size}"/>` : '');
  const body = escapeXml(text).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  return `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${body}</w:t></w:r>`;
};
const LINE_BREAK = '<w:r><w:br/></w:r>';
const paraRuns = (runsXml, { align, spacingAfter = 0 } = {}) =>
  `<w:p><w:pPr><w:spacing w:after="${spacingAfter}" w:line="240" w:lineRule="auto"/>${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>${runsXml}</w:p>`;
const para = (text, opts = {}) => paraRuns(run(text, opts), opts);

const cellBorders = sides => sides.length
  ? `<w:tcBorders>${sides.map(s => `<w:${s} w:val="dashed" w:sz="4" w:space="0" w:color="000000"/>`).join('')}</w:tcBorders>`
  : '';
const cell = (width, contentXml, { span, borders = [] } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span ? `<w:gridSpan w:val="${span}"/>` : ''}${cellBorders(borders)}</w:tcPr>${contentXml}</w:tc>`;
const row = (cellsXml, { height } = {}) =>
  `<w:tr><w:trPr><w:cantSplit/>${height ? `<w:trHeight w:val="${height}"/>` : ''}</w:trPr>${cellsXml}</w:tr>`;

const TABLE_OPEN = `<w:tbl><w:tblPr><w:tblW w:w="${TOTAL}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${COL1}"/><w:gridCol w:w="${COL2}"/></w:tblGrid>`;
const TABLE_CLOSE = '</w:tbl>';

function signatureTable(rows) {
  if (!rows.length) return '';
  const trs = rows.map(([label, value]) => row(
    cell(SIG_COL1, para(label, { align: 'right' })) +
    cell(SIG_COL2, para(value, { align: 'right' }))
  )).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${SIG_COL1 + SIG_COL2}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${SIG_COL1}"/><w:gridCol w:w="${SIG_COL2}"/></w:tblGrid>${trs}</w:tbl>`;
}

const columnHeaderRow = (label1, label2) => row(
  cell(COL1, para(label1, { align: 'center', bold: true }), { borders: ['bottom', 'right'] }) +
  cell(COL2, para(label2, { bold: true }), { borders: ['left', 'bottom'] })
);
const dataRow = (a, b) => row(
  cell(COL1, para(a || ''), { borders: ['top', 'bottom', 'right'] }) +
  cell(COL2, para(b || ''), { borders: ['top', 'left', 'bottom'] })
);
const spacerRow = () => row(cell(TOTAL, para(''), { span: 2, borders: ['top', 'bottom'] }), { height: 130 });
const headingRow = text => row(cell(TOTAL, para(text, { align: 'center', bold: true }), { span: 2, borders: ['top', 'bottom'] }));

function dataSection(tableData, TL) {
  if (!tableData?.rows?.length) return '';
  return columnHeaderRow(TL.subject, TL.grade) + tableData.rows.map(r => dataRow(r.subject, r.grade)).join('');
}

// translation — то же самое, что во всех остальных рендерах (см.
// layoutBlocks/attestatBlocks в export.mjs): language, fields[] (уже
// переведённые label+value), tables[] (subject/grade построчно).
// certification — то же, что принимает certificationBlocks().
export function buildAttestatDocumentXml(translation, certification) {
  const lang = translation.language;
  const L = ATTESTAT_LABELS[lang] || ATTESTAT_LABELS.en;
  const TL = TABLE_LABELS[lang] || TABLE_LABELS.en;
  const fields = translation.fields || [];
  const map = Object.fromEntries(fields.filter(f => f.key).map(f => [f.key, f.value]));
  const byKey = key => fields.find(f => f.key === key);
  const sigPlaceholder = SIGNATURE_PLACEHOLDER[lang] || SIGNATURE_PLACEHOLDER.en;

  // --- шапка (row 0 в реальном образце): страна, вид документа и номер,
  // затем связный блок "кому выдан / место и дата рождения / где и когда
  // окончил" — те же лейблы и формулировки, что и в остальных форматах
  // экспорта (см. attestatBlocks в export.mjs), просто оформленные как
  // отдельные строки внутри реальной табличной вёрстки, а не одним абзацем.
  const headerParas = [];
  if (map.country) headerParas.push(para(map.country, { bold: true }));
  const titleLine = [map.documentType, map.documentNumber && `${L.number} ${map.documentNumber}`].filter(Boolean).join('   ');
  if (titleLine) headerParas.push(para(titleLine, { align: 'center', bold: true }));
  headerParas.push(para(''));
  if (map.fullName) headerParas.push(paraRuns(run(`${L.holder}:`) + LINE_BREAK + run(map.fullName, { bold: true, italic: true })));
  const born = [map.birthPlace, map.birthDate].filter(Boolean).join(', ');
  if (born) headerParas.push(para(`${L.bornAt}: ${born}`));
  const graduated = [map.institution, map.graduationYear].filter(Boolean).join(', ');
  if (graduated) headerParas.push(para(`${L.graduated}: ${graduated}`));
  let body = row(cell(TOTAL, headerParas.join(''), { span: 2 }));

  // --- предметы и итоговые экзамены — переменное число строк, не
  // фиксированное количество из образца (Ethan, 18 сен 2026: "если там
  // будет больше предметов, то нужно будет больше добавить").
  const subjectsData = (translation.tables || []).find(t => t.section === 'Предметы и оценки');
  const finalsData = (translation.tables || []).find(t => t.section === 'Итоговые экзамены и оценки');
  body += dataSection(subjectsData, TL);
  if (finalsData?.rows?.length) {
    body += spacerRow();
    body += headingRow(TL.finals);
    body += dataSection(finalsData, TL);
  }

  // --- подписи, дата выдачи, проверка подлинности, печать (row 32 в
  // образце). Лейблы (директор/завуч/кл. руководитель, дата выдачи,
  // ссылка проверки, рег. номер, печать) уже переведены на сервере (см.
  // FIELD_LABEL_TRANSLATIONS в lib/translationDocs/pipeline.js) — здесь
  // просто читаем их из fields, не переизобретаем перевод.
  const sigRows = [byKey('director'), byKey('deputyDirector'), byKey('classTeacher')]
    .filter(f => f && f.label)
    .map(f => [f.label, f.value || sigPlaceholder]);
  let footer = signatureTable(sigRows);
  footer += para('');
  const issueDateField = byKey('issueDate');
  if (issueDateField?.value) footer += paraRuns(run(`${issueDateField.label}: `) + run(issueDateField.value, { bold: true, italic: true }));
  const verificationField = byKey('verificationUrl');
  if (verificationField?.value) footer += paraRuns(run(`${verificationField.label}: `) + run(verificationField.value, { bold: true, italic: true }));
  if (fields.some(f => f.key === 'seal')) footer += para('M.P.', { bold: true, italic: true });
  const regField = byKey('registrationNumber');
  if (regField?.value) footer += para(`${regField.label}: ${regField.value}`, { bold: true, italic: true });
  const sealField = byKey('seal');
  if (sealField?.value) footer += para(`${sealField.label}: ${sealField.value}`);
  body += row(cell(TOTAL, footer, { span: 2, borders: ['top'] }));

  const tableXml = TABLE_OPEN + body + TABLE_CLOSE;
  // Приписка бюро переводов — то же самое, что и для остальных типов
  // документов (certificationBlocks в export.mjs): язык перевода первым
  // абзацем, язык оригинала вторым.
  const certParas = certificationBlocks(certification, lang).map(b => para(b.text, { size: 20 })).join('');
  const documentBody = tableXml + certParas;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + documentBody + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
