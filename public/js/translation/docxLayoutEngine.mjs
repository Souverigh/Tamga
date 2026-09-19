// docxLayoutEngine.mjs
// Переиспользуемые низкоуровневые примитивы для сборки .docx-разметки "как
// в Word" (не общий безрамочный рендер paragraph()/table() из export.mjs, а
// вёрстка, копирующая структуру настоящего документа): ячейка/строка/
// таблица с настраиваемыми рамками и шириной колонок, вложенная таблица
// (например блок подписей). Выделено из attestatDocx.mjs при переходе на
// декларативный конфиг под каждый тип документа — архитектура подтверждена
// Ethan через AskUserQuestion 18 сен 2026: движок общий и живёт в коде,
// новый тип документа описывается своим конфигом поверх этих примитивов, а
// не пишет вёрстку .docx заново.
//
// placeholderBox() добавлен 18-19 сен 2026 при подключении второго
// потребителя движка (ID-карта КР, buildIdCardDocumentXml в
// idCardDocx.mjs) — рамка-плейсхолдер вместо реального изображения (сам
// движок не встраивает картинки в .docx, только текстовую метку, как уже
// было принято для отсутствующей подписи в Аттестате). MRZ-блок НЕ
// добавлен — подтверждено Ethan через AskUserQuestion 18 сен 2026: MRZ не
// воспроизводится в переводе (служебная зона для сканеров, не текст для
// перевода), поэтому примитив для неё сейчас просто не нужен.

import { escapeXml } from './export.mjs';

export const rFonts = (name, eastAsia = 'SimSun') =>
  `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:cs="${name}" w:eastAsia="${eastAsia}"/>`;

// Фабрика text-run/paragraph хелперов, привязанных к шрифту конкретного
// типа документа — сам конфиг типа документа не передаёт шрифт в каждый
// вызов run()/para().
export function createTextHelpers(fontXml) {
  // underline добавлен 19 сен 2026 при подключении третьего потребителя
  // движка (Свидетельство о смерти, deathCertificateDocx.mjs) — в реальном
  // образце значения полей жирные И подчёркнутые (не просто жирные, как у
  // остальных типов).
  const run = (text, { bold, italic, underline, size } = {}) => {
    const rPr = fontXml + (bold ? '<w:b/><w:bCs/>' : '') + (italic ? '<w:i/><w:iCs/>' : '') + (underline ? '<w:u w:val="single"/>' : '') + (size ? `<w:sz w:val="${size}"/>` : '');
    const body = escapeXml(text).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
    return `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${body}</w:t></w:r>`;
  };
  const LINE_BREAK = '<w:r><w:br/></w:r>';
  const paraRuns = (runsXml, { align, spacingAfter = 0 } = {}) =>
    `<w:p><w:pPr><w:spacing w:after="${spacingAfter}" w:line="240" w:lineRule="auto"/>${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>${runsXml}</w:p>`;
  const para = (text, opts = {}) => paraRuns(run(text, opts), opts);
  return { run, para, paraRuns, LINE_BREAK };
}

// Рамки ячейки — по умолчанию пунктирные (как в Аттестате); стиль/толщина/
// цвет настраиваются под другой тип документа через borderOpts.
export const cellBorders = (sides, { style = 'dashed', sz = 4, color = '000000' } = {}) =>
  sides.length
    ? `<w:tcBorders>${sides.map(s => `<w:${s} w:val="${style}" w:sz="${sz}" w:space="0" w:color="${color}"/>`).join('')}</w:tcBorders>`
    : '';

export const cell = (width, contentXml, { span, borders = [], borderOpts } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span ? `<w:gridSpan w:val="${span}"/>` : ''}${cellBorders(borders, borderOpts)}</w:tcPr>${contentXml}</w:tc>`;

export const row = (cellsXml, { height } = {}) =>
  `<w:tr><w:trPr><w:cantSplit/>${height ? `<w:trHeight w:val="${height}"/>` : ''}</w:trPr>${cellsXml}</w:tr>`;

// Таблица верхнего уровня со сплошной внешней рамкой. По умолчанию
// top/left/bottom/right/insideV (без insideH) — так построена таблица
// Аттестата, где горизонтальные линии рисуют сами cell() через borders.
// sides позволяет задать другой набор (например + insideH для настоящей
// сетки, как в блоке ID-карты, или без insideV вовсе) под другой тип
// документа, не трогая дефолт для существующих.
export function table(colWidths, bodyXml, { borderStyle = 'single', borderSz = 4, borderColor = '000000', sides = ['top', 'left', 'bottom', 'right', 'insideV'] } = {}) {
  const total = colWidths.reduce((a, b) => a + b, 0);
  const side = s => `<w:${s} w:val="${borderStyle}" w:sz="${borderSz}" w:space="0" w:color="${borderColor}"/>`;
  const open = `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${sides.map(side).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${colWidths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  return open + bodyXml + '</w:tbl>';
}

// Вложенная таблица без настраиваемых внешних границ (например блок
// подписей директор/завуч/кл.руководитель внутри Аттестата) — rows: массив
// строк, каждая строка — массив уже готовых XML ячеек-параграфов, по одному
// на колонку из colWidths.
export function nestedTable(colWidths, rows) {
  const total = colWidths.reduce((a, b) => a + b, 0);
  const trs = rows.map(cellsXml => row(cellsXml.map((xml, i) => cell(colWidths[i], xml)).join(''))).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${colWidths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${trs}</w:tbl>`;
}

// Ячейка-плейсхолдер с рамкой по всем четырём сторонам и вертикально
// отцентрованным содержимым — например метка "[ФОТО]" на месте фото
// владельца документа (ID-карта и т.п.), когда встраивать настоящее
// изображение не нужно/не входит в объём. contentXml — уже готовый XML
// параграфа(ов), как для обычной cell().
export const placeholderBox = (width, contentXml, { borderOpts } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/>${cellBorders(['top', 'left', 'bottom', 'right'], borderOpts)}</w:tcPr>${contentXml}</w:tc>`;
