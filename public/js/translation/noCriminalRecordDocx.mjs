// Рендерer .docx для типа "Справка о несудимости" — снят с РЕАЛЬНОГО
// перевода бюро ("шаблон справка о несудимости Тундук.docx", прислан Ethan
// 19 сен 2026). В отличие от остальных типов "Перевода" (ЗАГС, паспорта)
// это НЕ бумажный бланк, а распечатка с портала электронных госуслуг
// Кыргызстана "Тундук" — оттуда специфичные поля: идентификационный код,
// дата/время формирования документа, блок электронной подписи (дата+код).
//
// Структура образца: заголовок (страна + длинное официальное название
// справки), затем таблица [лейбл|значение] тонкой сплошной сеткой (не
// двойная рамка, как у свидетельства о смерти, и не пунктир, как у
// Аттестата) с разделом "SERVICE RESULT" посередине (строка на всю
// ширину), затем СВОБОДНЫЕ абзацы после таблицы (юридические примечания
// портала — об источнике данных через Тундук, о юридической силе
// документа со ссылкой на постановление правительства, об актуальности
// данных), инструкция сканировать QR-код, строка "сформировано порталом",
// и рамка-бокс с уведомлением об электронной подписи (дата+код).
//
// Сознательное архитектурное решение: юридические примечания после
// таблицы (sourceSystemNote/legalValidityNote/actualityNote) — ОБЫЧНЫЕ
// ИЗВЛЕКАЕМЫЕ ПОЛЯ (значение приходит от Gemini с реального документа
// клиента и переводится обычным translateSegments, как и все остальные
// поля), а НЕ хардкод фиксированного текста на 8 языков в этом файле —
// в отличие от простых слов-плейсхолдеров ("ПАСПОРТ", "РОДИТЕЛИ" и т.п.)
// у других типов, эти абзацы — юридический текст со ссылкой на конкретное
// постановление правительства; фабриковать его перевод на 8 языков без
// сверки с реальным источником было бы неоправданным риском. Хардкожены
// только короткие процедурные фразы без юридического содержания (заголовок
// раздела "SERVICE RESULT", инструкция сканировать QR-код, уведомление об
// электронной подписи в рамке) — тот же уровень риска, что у уже принятых
// плейсхолдеров подписи/фото в других типах.
import { certificationBlocks } from './export.mjs';
import { rFonts, createTextHelpers, cell, row, table } from './docxLayoutEngine.mjs';

const FONT = rFonts('Times New Roman');
const { run, para, paraRuns } = createTextHelpers(FONT);

const LABEL_COL = 3600, VALUE_COL = 5900;
const TOTAL = LABEL_COL + VALUE_COL;

const TITLE = {
  ru: 'СПРАВКА О НАЛИЧИИ (ОТСУТСТВИИ) СУДИМОСТИ ЛИЦА НА ТЕРРИТОРИИ КЫРГЫЗСКОЙ РЕСПУБЛИКИ',
  ky: 'КЫРГЫЗ РЕСПУБЛИКАСЫНЫН АЙМАГЫНДА АДАМДЫН СОТТУУЛУГУНУН БАРДЫГЫ (ЖОКТУГУ) ЖӨНҮНДӨ КҮБӨЛӨНДҮРМӨ',
  en: 'CERTIFICATE OF CRIMINAL PROSECUTION OF A PERSON, PRESENCE OR ABSENCE OF A CRIMINAL RECORD OF A PERSON IN THE TERRITORY OF THE KYRGYZ REPUBLIC',
  kk: 'ҚЫРҒЫЗ РЕСПУБЛИКАСЫНЫҢ АУМАҒЫНДА АДАМНЫҢ СОТТЫЛЫҒЫНЫҢ БАР (ЖОҚ) ЕКЕНДІГІ ТУРАЛЫ АНЫҚТАМА',
  uz: 'QIRG‘IZISTON RESPUBLIKASI HUDUDIDA SHAXSNING SUDLANGANLIGI BOR (YO‘Q)LIGI HAQIDA MA’LUMOTNOMA',
  tr: 'KIRGIZ CUMHURİYETİ TOPRAKLARINDA BİR KİŞİNİN SABIKA KAYDININ VARLIĞI (YOKLUĞU) HAKKINDA BELGE',
  zh: '关于该人在吉尔吉斯共和国境内是否有犯罪记录的证明',
  de: 'BESCHEINIGUNG ÜBER DAS VORHANDENSEIN (NICHTVORHANDENSEIN) EINES VORSTRAFENREGISTERS EINER PERSON AUF DEM GEBIET DER KIRGISISCHEN REPUBLIK'
};
const SERVICE_RESULT_HEADING = {
  ru: 'РЕЗУЛЬТАТ УСЛУГИ', ky: 'КЫЗМАТТЫН ЖЫЙЫНТЫГЫ', en: 'SERVICE RESULT', kk: 'ҚЫЗМЕТ НӘТИЖЕСІ',
  uz: 'XIZMAT NATIJASI', tr: 'HİZMET SONUCU', zh: '服务结果', de: 'DIENSTLEISTUNGSERGEBNIS'
};
// Ethan, 19 сен 2026: экспортируется для familyCompositionDocx.mjs — та же
// процедурная фраза портала "Тундук", не дублируем 8 переводов.
export const QR_INSTRUCTION = {
  ru: 'Для проверки данных отсканируйте QR-код ниже:', ky: 'Маалыматты текшерүү үчүн төмөнкү QR-кодду сканерлеңиз:',
  en: 'For data verification, it is necessary to scan the QR code below:', kk: 'Деректерді тексеру үшін төмендегі QR-кодты сканерлеңіз:',
  uz: 'Ma’lumotlarni tekshirish uchun quyidagi QR-kodni skanerlang:', tr: 'Verileri doğrulamak için aşağıdaki QR kodunu tarayın:',
  zh: '如需验证数据，请扫描下方二维码：', de: 'Zur Datenüberprüfung scannen Sie bitte den untenstehenden QR-Code:'
};
export const ESIGNATURE_NOTICE = {
  ru: 'На документ наложена электронная подпись Государственного портала электронных услуг.',
  ky: 'Документке Мамлекеттик электрондук кызматтар порталынын электрондук колу коюлган.',
  en: 'An e-signature of the State Electronic Services Portal has been placed on the document.',
  kk: 'Құжатқа Мемлекеттік электрондық қызметтер порталының электрондық қолтаңбасы қойылған.',
  uz: 'Hujjatga Davlat elektron xizmatlar portalining elektron imzosi qo‘yilgan.',
  tr: 'Belgeye Devlet Elektronik Hizmetler Portalının e-imzası eklenmiştir.',
  zh: '本文件已加盖国家电子服务门户的电子签名。',
  de: 'Das Dokument wurde mit der elektronischen Signatur des Staatlichen Portals für elektronische Dienstleistungen versehen.'
};

function fieldLine(field) {
  if (!field?.value) return '';
  return paraRuns(run(`${field.label}: `) + run(field.value, { bold: true }));
}

// translation — то же самое, что у остальных типов: language, fields[]
// (уже переведённые label+value). certification — то же, что принимает
// certificationBlocks().
export function buildNoCriminalRecordDocumentXml(translation, certification) {
  const lang = translation.language;
  const fields = translation.fields || [];
  const map = Object.fromEntries(fields.filter(f => f.key).map(f => [f.key, f]));
  const title = TITLE[lang] || TITLE.en;
  const serviceResultHeading = SERVICE_RESULT_HEADING[lang] || SERVICE_RESULT_HEADING.en;
  const qrInstruction = QR_INSTRUCTION[lang] || QR_INSTRUCTION.en;
  const esigNotice = ESIGNATURE_NOTICE[lang] || ESIGNATURE_NOTICE.en;

  // stampText — читаемая отметка поверх бланка (см. birthCertificateDocx.mjs).
  const stampXml = map.stampText?.value ? para(map.stampText.value, { align: 'center', bold: true, italic: true }) + para('') : '';
  const header = (map.country?.value ? para(map.country.value, { align: 'center', size: 24 }) : '')
    + para('') + para(title, { align: 'center', size: 22 }) + para('');

  // --- таблица: применяющий + результат услуги + технические поля.
  const twoColRow = field => field?.value
    ? row(cell(LABEL_COL, para(field.label)) + cell(VALUE_COL, para(field.value, { bold: true })))
    : '';
  const spanRow = xml => row(cell(TOTAL, xml, { span: 2 }));

  let body = '';
  body += twoColRow(map.fullName);
  body += twoColRow(map.taxId);
  body += spanRow(para(serviceResultHeading, { align: 'center', bold: true, size: 24 }));
  body += twoColRow(map.certificateStatus);
  body += twoColRow(map.identificationCode);
  body += twoColRow(map.issuanceNote);
  body += twoColRow(map.issuingAuthority);
  if (map.contactNote?.value) body += spanRow(para(map.contactNote.value));
  body += twoColRow(map.documentNumber);
  body += twoColRow(map.formationDateTime);

  const mainTableXml = table([LABEL_COL, VALUE_COL], body, { sides: ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] });

  // --- юридические примечания портала после таблицы — обычные поля (см.
  // комментарий в шапке файла), не хардкод.
  const notesXml = [map.sourceSystemNote, map.legalValidityNote, map.actualityNote]
    .filter(f => f?.value)
    .map(f => para(f.value, { align: 'both' }) + para(''))
    .join('');

  // QR — только если модель увидела его на документе (map.qrCode.value —
  // локализованный маркер "[QR code]", см. localizeMarkers), а не безусловно
  // (Ethan, 19 сен 2026: "печати, подписи, QR-коды — обрабатывать так же").
  const qrXml = map.qrCode?.value
    ? para(qrInstruction, { align: 'right' }) + para(map.qrCode.value, { italic: true, align: 'right' }) + para('')
    : '';
  const formedByXml = map.formedByAuthority?.value ? fieldLine(map.formedByAuthority) + para('') : '';

  // --- рамка-бокс с уведомлением об электронной подписи (дата+код) — как
  // в образце, отдельная маленькая таблица с рамкой по периметру.
  let esigXml = '';
  if (map.signatureDate?.value || map.signatureCode?.value) {
    const esigBody = para(esigNotice, { italic: true }) + fieldLine(map.signatureDate) + fieldLine(map.signatureCode);
    esigXml = table([TOTAL], row(cell(TOTAL, esigBody)), { sides: ['top', 'left', 'bottom', 'right'] });
  }

  const certParas = certificationBlocks(certification, lang).map(b => para(b.text, { size: 20 })).join('');
  const documentBody = stampXml + header + mainTableXml + para('') + notesXml + qrXml + formedByXml + esigXml + certParas;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + documentBody + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
