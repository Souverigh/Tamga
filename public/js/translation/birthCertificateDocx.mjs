// Рендерer .docx для типа "Свидетельство о рождении" — снят с РЕАЛЬНОГО
// перевода бюро ("шаблон свидетельство о рождении.docx", прислан Ethan
// 19 сен 2026: киргизское свидетельство о рождении, переведённое на
// английский). Тип уже существовал в DOC_TYPES (общий список, см.
// docSchema.js) с заглушечным списком полей — здесь только вёрстка +
// расширенный список полей (documentStructures.js), сам тип из общего
// /api/recognize никуда не выносился.
//
// Структура реального образца: ОДНА таблица, ОДНА строка, ДВЕ большие
// ячейки (внешняя рамка + один вертикальный разделитель между колонками,
// без горизонтальных линий — сплошной поток абзацев внутри каждой ячейки).
// Левая колонка: страна+заголовок, данные ребёнка (ФИО/ПИН/дата и место
// рождения/номер и дата актовой записи), штамп-код документа. Правая
// колонка: заголовок "РОДИТЕЛИ", блок отца (ФИО/ПИН/гражданство/
// национальность), блок матери (то же самое), место и дата регистрации,
// ответственный сотрудник ЗАГС с подписью, печать/штамп.
//
// Сознательные отличия от буквального образца (тот же принцип, что и у
// Паспорта Канады/ID-карты — не склейка чужого XML, а вёрстка с теми же
// визуальными параметрами):
//  - Номера полей ("01.", "02." ...) из образца НЕ воспроизводятся — это
//    служебная нумерация конкретного киргизского бланка, а не общий
//    конвент рендеров в этом проекте (ни Аттестат, ни ID-карта, ни Паспорт
//    Канады номера полей не печатают). Пункт "05." образца (номер записи +
//    дата одним предложением) разбит на два обычных поля label/value —
//    так же, как Паспорт Канады разбивает свою строку Тип/Код/Номер на
//    отдельные стековые поля, вместо того чтобы собирать многоязычное
//    предложение-конструктор.
//  - QR-код (декоративная рамка-плейсхолдер в образце) не рисуется —
//    QR-код на реальном бланке дублирует document-номер, который и так
//    печатается как поле; сам номер в образце дан ДВАЖДЫ подряд, здесь —
//    один раз (тот же принцип, что и у номера страницы вкладыша Паспорта
//    Канады: повтор не несёт новой информации).
//  - Название департамента-штампа в образце ("Department of Registration
//    of Population...") — это конкретный текст ОДНОГО присланного примера,
//    не хардкодится: печать/штамп — обычное поле (seal, переиспользован
//    из Аттестата), со значением, которое распознает модель на конкретном
//    документе клиента, а не зафиксированная в вёрстке цитата.
//  - Страна ("KYRGYZ REPUBLIC" в образце) НЕ зафиксирована в вёрстке, в
//    отличие от Паспорта Канады/Узбекистана — тип общий для любой страны
//    (country — обычное опциональное поле, тот же приём, что у Аттестата/
//    ID-карты).
import { certificationBlocks } from './export.mjs';
import { rFonts, createTextHelpers, cell, row, table } from './docxLayoutEngine.mjs';

const FONT = rFonts('Times New Roman');
const { run, para, paraRuns } = createTextHelpers(FONT);

// Ширины колонок — сняты с образца (5240/5216).
const COL_L = 5240, COL_R = 5216;

const TITLE = {
  ru: 'СВИДЕТЕЛЬСТВО О РОЖДЕНИИ', ky: 'ТУУЛГАНДЫГЫ ЖӨНҮНДӨ КҮБӨЛҮК', en: 'BIRTH CERTIFICATE',
  kk: 'ТУУ ТУРАЛЫ КУӘЛІК', uz: 'TUG‘ILGANLIK HAQIDA GUVOHNOMA', tr: 'DOĞUM BELGESİ', zh: '出生证明', de: 'GEBURTSURKUNDE'
};
const PARENTS_HEADING = {
  ru: 'РОДИТЕЛИ', ky: 'АТА-ЭНЕСИ', en: 'PARENTS', kk: 'АТА-АНАСЫ',
  uz: 'OTA-ONASI', tr: 'EBEVEYNLER', zh: '父母', de: 'ELTERN'
};
function fieldBlock(field) {
  if (!field?.value) return '';
  return para(`${field.label}:`) + para(field.value, { bold: true });
}

// translation — как и у остальных типов: language, fields[] (уже
// переведённые label+value, ключи — как в STANDARD_TRANSLATION_FIELDS
// этого типа в documentStructures.js). certification — то же, что
// принимает certificationBlocks().
export function buildBirthCertificateDocumentXml(translation, certification) {
  const lang = translation.language;
  const fields = translation.fields || [];
  const map = Object.fromEntries(fields.filter(f => f.key).map(f => [f.key, f]));
  const title = TITLE[lang] || TITLE.en;
  const parentsHeading = PARENTS_HEADING[lang] || PARENTS_HEADING.en;

  // stampText (Ethan, 19 сен 2026, реальный пример — штамп "КАЙТАЛАНГАН" =
  // "Дубликат/Повторно") — читаемая отметка поверх бланка, относится к
  // документу в целом, а не к конкретному полю внутри одной из колонок —
  // показываем баннером над основной таблицей, как на реальном скане.
  const stampXml = map.stampText?.value ? para(map.stampText.value, { align: 'center', bold: true, italic: true }) + para('') : '';

  // --- левая колонка: страна (опционально) + заголовок, данные ребёнка,
  // номер и дата актовой записи, номер/код документа внизу.
  const leftTop = (map.country?.value ? para(map.country.value, { align: 'center', bold: true, size: 24 }) + para('') : '')
    + para(title, { align: 'center', bold: true, size: 28 }) + para('');
  const leftFields = [map.fullName, map.taxId, map.birthDate, map.birthPlace, map.recordNumber, map.recordDate]
    .map(fieldBlock).join('');
  const leftBottom = map.documentNumber?.value ? para('') + para(map.documentNumber.value, { bold: true }) : '';
  const leftXml = leftTop + leftFields + leftBottom;

  // --- правая колонка: "РОДИТЕЛИ", блок отца, блок матери, место и дата
  // регистрации, ответственный сотрудник (подпись + ФИО), печать/штамп.
  const parentsFields = [
    map.fatherName, map.fatherPin, map.fatherCitizenship, map.fatherNationality,
    map.motherName, map.motherPin, map.motherCitizenship, map.motherNationality
  ].map(fieldBlock).join('');
  const registrationFields = [map.issuingAuthority, map.issueDate].map(fieldBlock).join('');
  // signature — отдельное поле (kind: 'signature', см. documentStructures.js):
  // модель сама решает, есть ли на конкретном документе графическая подпись
  // рядом с ФИО, вместо того чтобы всегда дорисовывать плейсхолдер (Ethan,
  // 19 сен 2026: раньше подпись показывалась безусловно для любого документа
  // с заполненным responsibleEmployee, даже если её на самом деле нет).
  const employeeXml = map.responsibleEmployee?.value
    ? para(`${map.responsibleEmployee.label}:`) + paraRuns((map.signature?.value ? run(`${map.signature.value}  `, { italic: true }) : '') + run(map.responsibleEmployee.value, { bold: true }))
    : '';
  const sealXml = map.seal?.value ? para('') + para(`${map.seal.label}: ${map.seal.value}`, { italic: true }) : '';
  const rightXml = para(parentsHeading, { bold: true }) + para('') + parentsFields + registrationFields + employeeXml + sealXml;

  const mainTableXml = table([COL_L, COL_R], row(cell(COL_L, leftXml) + cell(COL_R, rightXml)), { sides: ['top', 'left', 'bottom', 'right', 'insideV'] });

  const certParas = certificationBlocks(certification, lang).map(b => para(b.text, { size: 20 })).join('');
  const documentBody = stampXml + mainTableXml + certParas;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + documentBody + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
