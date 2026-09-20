// Рендерер .docx для типа "Информация о составе семьи" — вторая распечатка с
// портала электронных госуслуг Кыргызстана "Тундук" (первая — "Справка о
// несудимости", см. noCriminalRecordDocx.mjs). Ethan, 19 сен 2026, реальный
// пример: "87b23580-946f-11f1-8b19-adb1175c5ae6.pdf".
//
// ВАЖНО: в отличие от остальных вёрсток, эта написана БЕЗ реального
// английского перевода бюро — только по одному исходному документу и по
// вёрстке соседней "Справки о несудимости" (тот же портал, тот же блок QR-кода
// и электронной подписи). Порядок блоков (реквизиты → таблица членов семьи →
// орган выдачи/номер/дата формирования → примечания портала → QR → подпись)
// — обоснованное предположение, а не снимок с образца бюро; поправить, когда
// появится настоящий перевод.
//
// Заголовок и подписи колонок — короткие фразы без юридического содержания,
// хардкод на 8 языков (тот же уровень риска, что заголовок у несудимости).
// Юридические примечания портала (sourceSystemNote/legalValidityNote/
// actualityNote) — обычные извлекаемые поля, а не хардкод (см. подробное
// обоснование в noCriminalRecordDocx.mjs).
//
// Таблица членов семьи приходит НЕ полями, а отдельным массивом
// translation.familyMembers (см. lib/translationDocs/pipeline.js и
// export-model.mjs): fullName/relationship/birthDate уже переведены.
// Порядковый номер строки вёрстка ставит сама.
import { certificationBlocks, FAMILY_TABLE_LABELS } from './export.mjs';
import { rFonts, createTextHelpers, cell, row, table } from './docxLayoutEngine.mjs';
import { QR_INSTRUCTION, ESIGNATURE_NOTICE } from './noCriminalRecordDocx.mjs';

const FONT = rFonts('Times New Roman');
const { run, para, paraRuns } = createTextHelpers(FONT);

const LABEL_COL = 3600, VALUE_COL = 5900;
const TOTAL = LABEL_COL + VALUE_COL;
const FAMILY_COLS = [700, 3800, 2500, 2500];

const TITLE = {
  ru: 'ИНФОРМАЦИЯ О СОСТАВЕ СЕМЬИ', ky: 'ҮЙ-БҮЛӨНҮН КУРАМЫ ЖӨНҮНДӨ МААЛЫМАТ', en: 'INFORMATION ON FAMILY COMPOSITION',
  kk: 'ОТБАСЫ ҚҰРАМЫ ТУРАЛЫ АҚПАРАТ', uz: 'OILA TARKIBI HAQIDA MA’LUMOT', tr: 'AİLE BİREYLERİ HAKKINDA BİLGİ',
  zh: '家庭成员信息', de: 'INFORMATION ÜBER DIE ZUSAMMENSETZUNG DER FAMILIE'
};

function fieldLine(field) {
  if (!field?.value) return '';
  return paraRuns(run(`${field.label}: `) + run(field.value, { bold: true }));
}

// translation — то же, что у остальных типов: language, fields[] (уже
// переведённые label+value) и familyMembers[]. certification — то же, что
// принимает certificationBlocks().
export function buildFamilyCompositionDocumentXml(translation, certification) {
  const lang = translation.language;
  const fields = translation.fields || [];
  const map = Object.fromEntries(fields.filter(f => f.key).map(f => [f.key, f]));
  const members = (translation.familyMembers || []).filter(m => m.fullName || m.relationship || m.birthDate);
  const title = TITLE[lang] || TITLE.en;
  const FL = FAMILY_TABLE_LABELS[lang] || FAMILY_TABLE_LABELS.en;
  const qrInstruction = QR_INSTRUCTION[lang] || QR_INSTRUCTION.en;
  const esigNotice = ESIGNATURE_NOTICE[lang] || ESIGNATURE_NOTICE.en;
  const gridSides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];

  // stampText — читаемая отметка поверх бланка (см. birthCertificateDocx.mjs).
  const stampXml = map.stampText?.value ? para(map.stampText.value, { align: 'center', bold: true, italic: true }) + para('') : '';
  const header = (map.country?.value ? para(map.country.value, { align: 'center', size: 24 }) : '')
    + para('') + para(title, { align: 'center', size: 22 }) + para('');

  const twoColRow = field => field?.value
    ? row(cell(LABEL_COL, para(field.label)) + cell(VALUE_COL, para(field.value, { bold: true })))
    : '';
  const spanRow = xml => row(cell(TOTAL, xml, { span: 2 }));

  // --- реквизиты заявителя.
  const applicantBody = twoColRow(map.fullName) + twoColRow(map.taxId) + twoColRow(map.memberCount) + twoColRow(map.address);
  const applicantXml = applicantBody ? table([LABEL_COL, VALUE_COL], applicantBody, { sides: gridSides }) + para('') : '';

  // --- таблица членов семьи; заголовок колонок жирным, № строки — по порядку.
  let familyXml = '';
  if (members.length) {
    const headCells = [FL.number, FL.fullName, FL.relationship, FL.birthDate]
      .map((text, i) => cell(FAMILY_COLS[i], para(text, { bold: true, align: 'center' }))).join('');
    const bodyRows = members.map((member, index) => row(
      [String(index + 1), member.fullName, member.relationship, member.birthDate]
        .map((text, i) => cell(FAMILY_COLS[i], para(text || '', i === 0 ? { align: 'center' } : {}))).join('')
    )).join('');
    familyXml = table(FAMILY_COLS, row(headCells) + bodyRows, { sides: gridSides }) + para('');
  }

  // --- орган выдачи / номер / дата формирования.
  let issuerBody = twoColRow(map.issuingAuthority);
  if (map.contactNote?.value) issuerBody += spanRow(para(map.contactNote.value));
  issuerBody += twoColRow(map.documentNumber) + twoColRow(map.formationDateTime);
  const issuerXml = issuerBody ? table([LABEL_COL, VALUE_COL], issuerBody, { sides: gridSides }) + para('') : '';

  const notesXml = [map.sourceSystemNote, map.legalValidityNote, map.actualityNote]
    .filter(f => f?.value)
    .map(f => para(f.value, { align: 'both' }) + para(''))
    .join('');

  // QR — только если модель увидела его на документе (map.qrCode.value —
  // локализованный маркер "[QR code]", см. localizeMarkers), а не безусловно.
  const qrXml = map.qrCode?.value
    ? para(qrInstruction, { align: 'right' }) + para(map.qrCode.value, { italic: true, align: 'right' }) + para('')
    : '';
  const formedByXml = map.formedByAuthority?.value ? fieldLine(map.formedByAuthority) + para('') : '';

  let esigXml = '';
  if (map.signatureDate?.value || map.signatureCode?.value) {
    const esigBody = para(esigNotice, { italic: true }) + fieldLine(map.signatureDate) + fieldLine(map.signatureCode);
    esigXml = table([TOTAL], row(cell(TOTAL, esigBody)), { sides: ['top', 'left', 'bottom', 'right'] });
  }

  const certParas = certificationBlocks(certification, lang).map(b => para(b.text, { size: 20 })).join('');
  const documentBody = stampXml + header + applicantXml + familyXml + issuerXml + notesXml + qrXml + formedByXml + esigXml + certParas;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + documentBody + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
