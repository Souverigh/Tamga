// Рендерer .docx для типа "Свидетельство о смерти" — снят с РЕАЛЬНОГО
// перевода бюро ("свидетельство о смерти шаблон.docx", прислан Ethan
// 19 сен 2026: киргизское свидетельство о смерти, переведённое на
// английский). Тип уже существовал в DOC_TYPES с заглушечным списком полей
// (см. комментарий в documentStructures.js), здесь только расширенный
// список полей + вёрстка — тот же приём, что и у birthCertificateDocx.mjs
// (родственный тип, тот же ЗАГС, во многом переиспользует те же поля).
//
// Структура реального образца: ОДНА таблица, ОДНА строка, ОДНА ячейка на
// всю ширину (gridCol 9500) — не два столбца, как у свидетельства о
// рождении. Внешняя рамка — сплошная ДВОЙНАЯ линия sz12 (borderStyle:
// 'double', как у passportUzbekistanOldDocx.mjs). Каждое поле — ОДНА
// строка "N. Лейбл: ЗНАЧЕНИЕ" (лейбл обычным начертанием, значение жирным
// И ПОДЧЁРКНУТЫМ — в отличие от остальных типов проекта, где значение
// только жирное; отсюда добавка `underline` в docxLayoutEngine.mjs
// createTextHelpers().run()).
//
// Присланный образец — это НОТАРИАЛЬНО ЗАВЕРЕННАЯ КОПИЯ перевода (после
// самого свидетельства идёт текст нотариуса "certify this copy to be a
// true copy of the original document...", номер в реестре нотариуса,
// госпошлина, печать нотариуса, штамp об электронной подписи, затем уже
// стандартная приписка бюро переводов). Этот блок НЕ воспроизводится —
// это не структура самого свидетельства о смерти как типа документа, а
// отдельный, общий для ЛЮБОГО типа документа сценарий "клиент подал
// нотариально заверенную копию, а не оригинал" — если понадобится, это
// отдельная задача (не специфичная для смерти/рождения), см. TECH_DEBT.md.
// Стандартная приписка бюро переводов (реквизиты компании + "Настоящий
// перевод... выполнен переводчиком...") уже покрыта общим механизмом
// certificationBlocks() (export.mjs) — образец её текстуально подтверждает
// (сравнил дословно, полное совпадение с уже реализованным форматом).
//
// Сознательные упрощения vs буквальный образец (тот же принцип, что и у
// остальных типов — см. комментарий в birthCertificateDocx.mjs):
//  - Номера полей "01."..."11." НЕ воспроизводятся.
//  - Поле 08 образца ("Recorded in the Death Registration Book: record
//    No. 363, entered on 18.08.2020") разбито на recordNumber/recordDate —
//    те же id, что уже завёл birthCertificateDocx.mjs для аналогичного
//    поля актовой записи.
//  - QR-код-плейсхолдер (пустая рамка) не рисуется — печатается только его
//    значение (documentNumber), которое и так есть отдельным полем;
//    печатается один раз, хотя в образце строка дублируется.
//  - Штампы "[Stamp: COPY]"/"[Stamp: SEE OVERLEAF]" — служебные пометки
//    конкретно ЭТОЙ нотариальной копии, не элемент бланка свидетельства
//    как такового — не воспроизводятся.
//  - Страна ("Kyrgyz Republic") НЕ зафиксирована в вёрстке — тип общий для
//    любой страны, как и у свидетельства о рождении/Аттестата.
import { certificationBlocks } from './export.mjs';
import { rFonts, createTextHelpers, cell, row, table } from './docxLayoutEngine.mjs';

const FONT = rFonts('Times New Roman');
const { run, para, paraRuns } = createTextHelpers(FONT);

const TOTAL = 9500;

const TITLE = {
  ru: 'СВИДЕТЕЛЬСТВО О СМЕРТИ', ky: 'ӨЛГӨНДҮГҮ ЖӨНҮНДӨ КҮБӨЛҮК', en: 'CERTIFICATE OF DEATH',
  kk: 'ҚАЙТЫС БОЛУ ТУРАЛЫ КУӘЛІК', uz: 'VAFOT ETGANLIK HAQIDA GUVOHNOMA', tr: 'ÖLÜM BELGESİ', zh: '死亡证明', de: 'STERBEURKUNDE',
  it: 'CERTIFICATO DI MORTE', es: 'CERTIFICADO DE DEFUNCIÓN'
};
// Лейбл обычным начертанием, значение жирным И подчёркнутым, на одной
// строке — как в образце (в отличие от stacked-полей свидетельства о
// рождении, где лейбл и значение на РАЗНЫХ строках).
function fieldLine(field) {
  if (!field?.value) return '';
  return paraRuns(run(`${field.label}: `) + run(field.value, { bold: true, underline: true }));
}

// translation — то же самое, что у остальных типов: language, fields[]
// (уже переведённые label+value). certification — то же, что принимает
// certificationBlocks().
export function buildDeathCertificateDocumentXml(translation, certification) {
  const lang = translation.language;
  const fields = translation.fields || [];
  const map = Object.fromEntries(fields.filter(f => f.key).map(f => [f.key, f]));
  const title = TITLE[lang] || TITLE.en;

  // stampText (см. birthCertificateDocx.mjs) — читаемая отметка поверх
  // бланка (например "Дубликат"), относится к документу в целом.
  const stampXml = map.stampText?.value ? para(map.stampText.value, { align: 'center', bold: true, italic: true }) + para('') : '';

  const header = (map.country?.value ? para(map.country.value, { align: 'center', bold: true, size: 24 }) : '')
    + para(title, { align: 'center', bold: true, size: 28 }) + para('');

  const bodyFields = [
    map.fullName, map.taxId, map.birthDate, map.birthPlace, map.citizenship,
    map.deathDate, map.deathPlace, map.recordNumber, map.recordDate,
    map.issuingAuthority, map.issueDate
  ].map(fieldLine).join('');

  // Ответственный сотрудник — та же строка "Лейбл: Значение", плюс маркер
  // подписи следом, только если модель действительно увидела графическую
  // подпись на этом документе (map.signature.value, kind: 'signature' — см.
  // documentStructures.js/birthCertificateDocx.mjs), а не безусловно.
  const employeeXml = map.responsibleEmployee?.value
    ? paraRuns(run(`${map.responsibleEmployee.label}: `) + run(map.responsibleEmployee.value, { bold: true, underline: true }) + (map.signature?.value ? run(`  ${map.signature.value}`, { italic: true }) : ''))
    : '';

  const sealXml = map.seal?.value ? para('') + para(`${map.seal.label}: ${map.seal.value}`, { italic: true }) : '';
  const documentNumberXml = map.documentNumber?.value ? para('') + para(map.documentNumber.value, { bold: true }) : '';

  const cellXml = header + bodyFields + employeeXml + sealXml + documentNumberXml;
  const mainTableXml = table([TOTAL], row(cell(TOTAL, cellXml)), { borderStyle: 'double', borderSz: 12, sides: ['top', 'left', 'bottom', 'right'] });

  const certParas = certificationBlocks(certification, lang).map(b => para(b.text, { size: 20 })).join('');
  const documentBody = stampXml + mainTableXml + certParas;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + documentBody + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
