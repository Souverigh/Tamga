import { validateApostille } from './apostille.mjs';
import { LANGUAGES } from './model.mjs';
import { buildAttestatDocumentXml } from './attestatDocx.mjs';
import { buildIdCardDocumentXml } from './idCardDocx.mjs';
import { buildPassportCanadaDocumentXml } from './passportCanadaDocx.mjs';
import { buildPassportUzbekistanOldDocumentXml } from './passportUzbekistanOldDocx.mjs';
import { buildPassportUzbekistanDocumentXml } from './passportUzbekistanDocx.mjs';
export const escapeXml = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');

// Приписка переводчика для приложения к переводу (Ethan, 17 сен 2026, со
// скриншота идеи; переделано 18 сен 2026 под реальный образец переводческой
// компании — файл "аттестат 9.docx"). Опциональна — блоков нет вообще, если
// ФИО переводчика не задано. ФИО хранится в client-settings
// (formatting.translatorName, см. api/client-settings.js) и подставляется
// панелью автоматически, но клиент может переопределить его перед
// конкретным экспортом.
//
// 18 сен 2026: первая версия (лейбл: значение построчно на двух языках,
// плюс ссылка на статью 87 закона о нотариате и рамка под печать нотариуса)
// заменена на формат реального бюро переводов — два компактных абзаца
// (сначала язык перевода, потом язык оригинала), каждый — реквизиты бюро и
// одно предложение "Настоящий перевод с X на Y выполнен переводчиком ИМЯ.
// Достоверность перевода подтверждается." Ссылки на закон о нотариате и
// места под печать нотариуса в этом образце нет — убраны; если понадобятся
// обратно, это отдельная просьба.
const CERTIFICATION_LABELS = {
  ru: { company: 'Компания', tin: 'ИНН', reg: 'ОКПО/регистрационный номер', address: 'Адрес', phone: 'Телефон', email: 'E-mail', translator: 'Переводчик', source: 'Язык оригинала', target: 'Язык перевода', date: 'Дата', signature: 'Подпись переводчика' },
  ky: { company: 'Компания', tin: 'ИНН', reg: 'ОКПО/каттоо номери', address: 'Дарек', phone: 'Телефон', email: 'E-mail', translator: 'Котормочу', source: 'Түп нуска тили', target: 'Котормо тили', date: 'Дата', signature: 'Котормочунун колу' },
  en: { company: 'Company', tin: 'TIN', reg: 'OKPO/registration number', address: 'Address', phone: 'Phone', email: 'E-mail', translator: 'Translator', source: 'Original language', target: 'Translation language', date: 'Date', signature: 'Translator signature' },
  kk: { company: 'Компания', tin: 'БСН/ЖСН', reg: 'ОКПО/тіркеу нөмірі', address: 'Мекенжай', phone: 'Телефон', email: 'E-mail', translator: 'Аудармашы', source: 'Түпнұсқа тілі', target: 'Аударма тілі', date: 'Күні', signature: 'Аудармашының қолы' },
  uz: { company: 'Kompaniya', tin: 'STIR', reg: 'OKPO/ro‘yxat raqami', address: 'Manzil', phone: 'Telefon', email: 'E-mail', translator: 'Tarjimon', source: 'Asl nusxa tili', target: 'Tarjima tili', date: 'Sana', signature: 'Tarjimon imzosi' },
  tr: { company: 'Şirket', tin: 'VKN', reg: 'OKPO/kayıt numarası', address: 'Adres', phone: 'Telefon', email: 'E-posta', translator: 'Çevirmen', source: 'Orijinal dil', target: 'Çeviri dili', date: 'Tarih', signature: 'Çevirmen imzası' },
  zh: { company: '公司', tin: '税号', reg: 'OKPO/注册号', address: '地址', phone: '电话', email: '电子邮箱', translator: '译者', source: '原文语言', target: '译文语言', date: '日期', signature: '译者签名' },
  de: { company: 'Unternehmen', tin: 'Steuernummer', reg: 'OKPO/Registrierungsnummer', address: 'Adresse', phone: 'Telefon', email: 'E-Mail', translator: 'Übersetzer', source: 'Originalsprache', target: 'Übersetzungssprache', date: 'Datum', signature: 'Unterschrift des Übersetzers' }
};

// Название языка ДАЁТСЯ НА ЯЗЫКЕ САМОЙ ФРАЗЫ — LANGUAGES выше фиксированно
// русский (нужен для дропдаунов), а не для вставки в предложение на любом
// из 8 языков экспорта: иначе в английском абзаце получилось бы "from
// Кыргызский into Китайский" — русские слова посреди английского текста
// (так было в старой версии). Для русского родительный падеж ("с ...
// языка") хранится отдельно — только для русского: точное склонение
// кыргызского/казахского и т.п. требует вычитки носителем (см. TECH_DEBT.md
// про машинный перевод на ky), поэтому для остальных 7 языков используется
// одна и та же словарная форма в обеих позициях.
const LANGUAGE_NAME_IN = {
  ru: { ru: 'русский', ky: 'кыргызский', en: 'английский', kk: 'казахский', uz: 'узбекский', tr: 'турецкий', zh: 'китайский', de: 'немецкий' },
  ky: { ru: 'орус', ky: 'кыргыз', en: 'англис', kk: 'казак', uz: 'өзбек', tr: 'түрк', zh: 'кытай', de: 'немис' },
  en: { ru: 'Russian', ky: 'Kyrgyz', en: 'English', kk: 'Kazakh', uz: 'Uzbek', tr: 'Turkish', zh: 'Chinese', de: 'German' },
  kk: { ru: 'орыс', ky: 'қырғыз', en: 'ағылшын', kk: 'қазақ', uz: 'өзбек', tr: 'түрік', zh: 'қытай', de: 'неміс' },
  uz: { ru: 'rus', ky: 'qirg‘iz', en: 'ingliz', kk: 'qozoq', uz: 'o‘zbek', tr: 'turk', zh: 'xitoy', de: 'nemis' },
  tr: { ru: 'Rusça', ky: 'Kırgızca', en: 'İngilizce', kk: 'Kazakça', uz: 'Özbekçe', tr: 'Türkçe', zh: 'Çince', de: 'Almanca' },
  zh: { ru: '俄语', ky: '吉尔吉斯语', en: '英语', kk: '哈萨克语', uz: '乌兹别克语', tr: '土耳其语', zh: '中文', de: '德语' },
  de: { ru: 'Russisch', ky: 'Kirgisisch', en: 'Englisch', kk: 'Kasachisch', uz: 'Usbekisch', tr: 'Türkisch', zh: 'Chinesisch', de: 'Deutsch' }
};
const RU_LANGUAGE_GENITIVE = { ru: 'русского', ky: 'кыргызского', en: 'английского', kk: 'казахского', uz: 'узбекского', tr: 'турецкого', zh: 'китайского', de: 'немецкого' };
function languageNameIn(lang, code) {
  if (!code) return '—';
  return (LANGUAGE_NAME_IN[lang] || LANGUAGE_NAME_IN.en)[code] || LANGUAGES[code] || code;
}
// Каждая функция возвращает [первое предложение (с ФИО), второе предложение
// (про достоверность)] — раздельно, чтобы вывести их отдельными строками,
// как в реальном образце (см. certificationBlocks ниже).
const CERTIFICATION_STATEMENT = {
  ru: (source, target, name) => [
    `Настоящий перевод с ${RU_LANGUAGE_GENITIVE[source] || languageNameIn('ru', source)} языка на ${languageNameIn('ru', target)} язык выполнен переводчиком ${name}.`,
    'Достоверность перевода подтверждается.'
  ],
  ky: (source, target, name) => [
    `Бул котормо ${languageNameIn('ky', source)} тилинен ${languageNameIn('ky', target)} тилине котормочу ${name} тарабынан аткарылды.`,
    'Котормонун тактыгы ушул менен күбөлөндүрүлөт.'
  ],
  en: (source, target, name) => [
    `This translation from ${languageNameIn('en', source)} into ${languageNameIn('en', target)} was made by the translator ${name}.`,
    'The accuracy of the translation is hereby certified.'
  ],
  kk: (source, target, name) => [
    `Осы аударма ${languageNameIn('kk', source)} тілінен ${languageNameIn('kk', target)} тіліне аудармашы ${name} тарапынан жасалды.`,
    'Аударманың дұрыстығы осымен куәландырылады.'
  ],
  uz: (source, target, name) => [
    `Ushbu tarjima ${languageNameIn('uz', source)} tilidan ${languageNameIn('uz', target)} tiliga tarjimon ${name} tomonidan bajarilgan.`,
    'Tarjimaning aniqligi shu bilan tasdiqlanadi.'
  ],
  tr: (source, target, name) => [
    `Bu çeviri ${languageNameIn('tr', source)} dilinden ${languageNameIn('tr', target)} diline çevirmen ${name} tarafından yapılmıştır.`,
    'Çevirinin doğruluğu işbu belge ile onaylanır.'
  ],
  zh: (source, target, name) => [
    `本翻译由译者${name}将${languageNameIn('zh', source)}译为${languageNameIn('zh', target)}。`,
    '特此证明翻译准确无误。'
  ],
  de: (source, target, name) => [
    `Diese Übersetzung aus dem ${languageNameIn('de', source)} ins ${languageNameIn('de', target)} wurde von der Übersetzerin/dem Übersetzer ${name} angefertigt.`,
    'Die Richtigkeit der Übersetzung wird hiermit bestätigt.'
  ]
};
export function certificationBlocks({ translatorName, sourceLanguage, companyName, taxId, registrationId, address, phone, email } = {}, targetLanguage) {
  const name = String(translatorName || '').trim();
  // Без ФИО переводчика приписывать нечего — блок не появляется вообще (то
  // же поведение, что и раньше: чекбокс в панели требует заполненного ФИО).
  if (!name) return [];
  const buildParagraph = lang => {
    const L = CERTIFICATION_LABELS[lang] || CERTIFICATION_LABELS.en;
    const line1 = [companyName, [taxId && `${L.tin}: ${taxId}`, registrationId && `${L.reg}: ${registrationId}`].filter(Boolean).join(' / ')].filter(Boolean).join(', ');
    // Адрес идёт как есть, без лейбла "Адрес:" — в реальном примере бюро
    // (см. ниже) адрес просто продолжает строку с телефоном/e-mail.
    const contactBits = [address, phone && `${L.phone}: ${phone}`, email && `E-mail: ${email}`].filter(Boolean).join(', ');
    const [sentence1, sentence2] = (CERTIFICATION_STATEMENT[lang] || CERTIFICATION_STATEMENT.en)(sourceLanguage, targetLanguage, name);
    const line2 = contactBits ? `${contactBits}   ${sentence1}` : sentence1;
    return [line1, line2, sentence2].filter(Boolean).join('\n');
  };
  // Целевой язык первым (его читает получатель перевода), язык оригинала
  // вторым (нужен нотариусу/бюро) — как в реальном образце переводческой
  // компании (Ethan, 18 сен 2026, "аттестат 9.docx"), а не построчно
  // попарно на двух языках сразу, как было раньше. Ссылку на статью 87
  // закона о нотариате и место под печать нотариуса убрали — в этом
  // реальном примере их нет; если понадобятся обратно, это отдельная
  // просьба, а не часть этой приписки.
  return [buildParagraph(targetLanguage), buildParagraph(sourceLanguage)].filter(Boolean).map(text => ({ text }));
}

export function documentBlocks(doc) {
  const blocks = [];
  if (doc.fields.length) blocks.push({table:doc.fields.map(f=>[f.label,f.value])});
  if (doc.columns.length && doc.items.length) blocks.push({table:[doc.columns,...doc.items.map(row=>doc.keys.map(k=>row[k]))]});
  doc.paragraphs.forEach(p=>blocks.push({text:p.text}));
  return blocks;
}
// "Аттестат" (Ethan, 18 сен 2026, со скриншота живого перевода человеком):
// ФИО/дата и место рождения/школа/год окончания читаются связным текстом
// ("This certificate is issued to: ИМЯ, born in ГОРОДЕ, on ДАТЕ, finished
// ШКОЛУ in ГОДУ"), а не таблицей "label: value" — так выглядит человеческий
// перевод такой справки, таблица "Реквизиты" для него читалась как сухая
// техническая карточка. Точную грамматику (падежи/род) для 8 языков не
// строим — тот же компромисс, что и в certificationBlocks() ниже: короткие
// подписанные фразы вместо одного грамматически идеального предложения на
// каждый язык. Сопоставление — по key поля (см. export-model.mjs), не по
// label: label уже переведён на язык экспорта.
export const ATTESTAT_LABELS = {
  ru: { holder: 'Настоящий документ выдан', bornAt: 'Место и дата рождения', graduated: 'Учебное заведение и год окончания', other: 'Подписи, печать и проверка', number: '№' },
  ky: { holder: 'Бул документ берилди', bornAt: 'Туулган жери жана күнү', graduated: 'Окуу жайы жана бүтүргөн жылы', other: 'Кол тамгалар, мөөр жана текшерүү', number: '№' },
  en: { holder: 'This certificate is issued to', bornAt: 'Born in, on', graduated: 'Graduated from, in', other: 'Signatures, seal and verification', number: 'No.' },
  kk: { holder: 'Осы құжат берілді', bornAt: 'Туған жері мен күні', graduated: 'Оқу орны және бітірген жылы', other: 'Қолтаңбалар, мөр және растау', number: '№' },
  uz: { holder: 'Ushbu hujjat berilgan', bornAt: 'Tug‘ilgan joyi va sanasi', graduated: 'Bitirgan muassasa va yili', other: 'Imzolar, muhr va tasdiqlash', number: '№' },
  tr: { holder: 'Bu belge şu kişiye verilmiştir', bornAt: 'Doğum yeri ve tarihi', graduated: 'Mezun olduğu kurum ve yıl', other: 'İmzalar, mühür ve doğrulama', number: 'No.' },
  zh: { holder: '本证书颁发给', bornAt: '出生地及出生日期', graduated: '毕业院校及毕业年份', other: '签字、印章及核验信息', number: '编号' },
  de: { holder: 'Dieses Dokument wurde ausgestellt für', bornAt: 'Geburtsort und -datum', graduated: 'Bildungseinrichtung und Abschlussjahr', other: 'Unterschriften, Siegel und Verifizierung', number: 'Nr.' }
};
const ATTESTAT_NARRATIVE_KEYS = ['country', 'documentType', 'documentNumber', 'fullName', 'birthPlace', 'birthDate', 'institution', 'graduationYear'];
function attestatBlocks(doc) {
  const L = ATTESTAT_LABELS[doc.language] || ATTESTAT_LABELS.en;
  const map = Object.fromEntries(doc.fields.filter(f => f.key).map(f => [f.key, f.value]));
  const blocks = [];
  const titleLine = [map.country, map.documentType, map.documentNumber && `${L.number} ${map.documentNumber}`].filter(Boolean).join(' ');
  if (titleLine) blocks.push({ heading: titleLine });
  const clauses = [];
  if (map.fullName) clauses.push(`${L.holder}: ${map.fullName}.`);
  const born = [map.birthPlace, map.birthDate].filter(Boolean).join(', ');
  if (born) clauses.push(`${L.bornAt}: ${born}.`);
  const graduated = [map.institution, map.graduationYear].filter(Boolean).join(', ');
  if (graduated) clauses.push(`${L.graduated}: ${graduated}.`);
  if (clauses.length) blocks.push({ text: clauses.join(' ') });
  // Остальные поля (директор, печать, регистрационный номер и т.п.) не
  // теряются — уходят отдельным блоком под своим заголовком, а не под
  // "Реквизиты", раз этой таблицы для Аттестата больше нет. subjectsAndGrades/
  // finalExamsAndGrades сюда не попадают: для старого формата ответа (см.
  // lib/translationDocs/legacyTables.js) это тот же самый текст, что уже
  // восстановлен в doc.tables построчно — иначе он задвоился бы.
  const used = new Set([...ATTESTAT_NARRATIVE_KEYS, 'subjectsAndGrades', 'finalExamsAndGrades']);
  const rest = doc.fields.filter(f => !used.has(f.key) && f.value);
  if (rest.length) blocks.push({ heading: L.other }, { table: rest.map(f => [f.label, f.value]) });
  return blocks;
}
export const TABLE_LABELS = {
  ru: { subject: 'Предмет', grade: 'Оценка', subjects: 'Предметы и оценки', finals: 'Итоговые экзамены и оценки' },
  ky: { subject: 'Сабак', grade: 'Баа', subjects: 'Сабактар жана баалар', finals: 'Жыйынтыктоочу экзамендер жана баалар' },
  en: { subject: 'Subject', grade: 'Grade', subjects: 'Subjects and Grades', finals: 'Final State Examinations' },
  kk: { subject: 'Пән', grade: 'Баға', subjects: 'Пәндер мен бағалар', finals: 'Қорытынды мемлекеттік емтихандар' },
  uz: { subject: 'Fan', grade: 'Baho', subjects: 'Fanlar va baholar', finals: 'Yakuniy davlat imtihonlari' },
  tr: { subject: 'Ders', grade: 'Not', subjects: 'Dersler ve Notlar', finals: 'Final Devlet Sınavları' },
  zh: { subject: '科目', grade: '成绩', subjects: '科目及成绩', finals: '国家毕业考试成绩' },
  de: { subject: 'Fach', grade: 'Note', subjects: 'Fächer und Noten', finals: 'Staatliche Abschlussprüfungen' }
};
// table.section приходит от Gemini как один из двух канонических русских
// лейблов полей (см. lib/translationDocs/documentStructures.js) независимо
// от языка экспорта — переводим по этому же принципу, что и лейблы полей
// выше, а не оставляем как есть.
// Gemini присылает table.section свободным текстом (теперь схема сама
// требует ровно одно из двух канонических значений — см.
// lib/translationDocs/pipeline.js, — но уже распознанные/закешированные
// документы могли прийти ДО этого ограничения). Классифицируем по
// ключевому слову, а не строгим совпадением: малейшее расхождение в
// формулировке иначе молча прячет всю таблицу предметов из перевода
// (живой баг, Ethan, 18 сен 2026 — распознанный аттестат, таблица
// предметов пропала из .docx целиком).
export const isFinalsSection = section => /итог|final|экзам/i.test(String(section || ''));
// Presentation only: retain every text fragment; remove redundant empty OCR
// lines from layout rather than treating them as Word line breaks plus margins.
export function layoutBlocks(doc) {
  const blocks=[];
  if (doc.docType === 'Аттестат' && doc.fields.length) {
    blocks.push(...attestatBlocks(doc));
  } else if (doc.fields.length) {
    blocks.push({heading:'Реквизиты'},{table:doc.fields.map(f=>[f.label,f.value])});
  }
  if(doc.columns.length&&doc.items.length)blocks.push({heading:'Табличные данные'},{table:[doc.columns,...doc.items.map(row=>doc.keys.map(k=>row[k]))]});
  const TL = TABLE_LABELS[doc.language] || TABLE_LABELS.en;
  (doc.tables || []).forEach(table => {
    if (!table.rows?.length) return;
    const heading = isFinalsSection(table.section) ? TL.finals : TL.subjects;
    blocks.push({heading}, {table: [[TL.subject, TL.grade], ...table.rows.map(row => [row.subject, row.grade])]});
  });
  // Для Аттестата поля+таблицы (предметы/оценки) уже полностью описывают
  // документ — сплошной текст распознавания снизу был бы точным дублем
  // уже показанных данных (Ethan, 18 сен 2026). preservesParagraphs теперь
  // выключен для Аттестата на уровне извлечения (documentStructures.js),
  // но проверка здесь нужна и для уже распознанных/закешированных на
  // клиенте документов, у которых paragraphs успели прийти раньше.
  const attestatCovered = doc.docType === 'Аттестат' && (doc.fields.length || (doc.tables||[]).some(t=>t.rows?.length));
  const paragraphs=attestatCovered ? [] : doc.paragraphs.flatMap(p=>String(p.text).split(/\r?\n\s*\r?\n/).map(text=>text.trim()).filter(Boolean));
  if(paragraphs.length)blocks.push({heading:'Полный текст распознавания — включая дополнительные отметки'},...paragraphs.map(text=>({text})));
  return blocks;
}

export function apostilleConvention(language) {
  return {
    ru: '(Гаагская конвенция от 5 октября 1961 года)',
    ky: '(Гаага конвенциясы, 1961-жылдын 5-октябры)',
    en: '(Convention de La Haye du 5 octobre 1961)',
    kk: '(1961 жылғы 5 қазандағы Гаага конвенциясы)',
    uz: '(1961-yil 5-oktabrdagi Gaaga konventsiyasi)',
    tr: '(5 Ekim 1961 tarihli Lahey Sözleşmesi)',
    zh: '(1961年10月5日《海牙公约》)',
    de: '(Haager Übereinkommen vom 5. Oktober 1961)'
  }[language] || '(Convention de La Haye du 5 octobre 1961)';
}

function apostilleBlocks(doc) {
  const elements = validateApostille(doc.elements, doc.language, true);
  const row = element => [
    element.number ? `${element.number}. ${element.label || ''}` : (element.label || ''),
    element.value || ''
  ];
  const fields = elements.filter(e => e.elementType !== 'stamp_text');
  return [
    { title: 'APOSTILLE', subtitle: apostilleConvention(doc.language),
      table: fields.map(row), widths: [3010, 6628], apostille: true },
    ...elements.filter(e => e.elementType === 'stamp_text').map(e => ({ text: `${doc.language === 'zh' ? '印章文字：' : 'Seal text: '}${e.value || ''}` }))
  ];
}

// Bilingual cell: original and translated value shown together, never one
// replacing the other. Used only where doubling the column count would make
// an already-wide table unreadable (line-item tables); requisites and running
// text get real side-by-side columns instead (see pairedLayoutBlocks below).
const bi = (a,b) => ({__bi:true, a:String(a??''), b:String(b??'')});

// Same shape as layoutBlocks, but merges original+translation into ONE set of
// blocks instead of two stacked documents — this is what a notarial-style
// bilingual translation actually looks like (source and target read side by
// side, not one after the other). Rows are always paired by array index:
// buildDocument/translatedDocument never add, drop or reorder fields, items
// or paragraphs, so original.fields[i]/translation.fields[i] (same for
// items/paragraphs) are always the same field — nothing can misalign here.
export function pairedLayoutBlocks(original,translation) {
  const blocks=[];
  if(original.fields.length){
    blocks.push({heading:'Реквизиты'});
    blocks.push({table:[['Поле','Оригинал','Перевод'],...original.fields.map((f,i)=>{
      const t=translation.fields[i];
      return [t.targetLabel||t.label,f.value,t.value];
    })]});
  }
  if(original.columns.length&&original.items.length){
    blocks.push({heading:'Табличные данные'});
    blocks.push({table:[
      original.columns.map((c,i)=>bi(c,translation.columns[i])),
      ...original.items.map((row,r)=>original.keys.map((k,c)=>bi(row[k],translation.items[r][original.keys[c]])))
    ]});
  }
  (original.tables || []).forEach((table, tableIndex) => {
    const translatedTable = translation.tables?.[tableIndex];
    if (!table.rows?.length || !translatedTable) return;
    blocks.push({heading: table.section || 'Предметы и оценки'});
    blocks.push({table: [['Предмет (оригинал)', 'Оценка (оригинал)', 'Предмет (перевод)', 'Оценка (перевод)'],
      ...table.rows.map((row, rowIndex) => {
        const translatedRow = translatedTable.rows[rowIndex] || {};
        return [row.subject, row.grade, translatedRow.subject, translatedRow.grade];
      })]});
  });
  const rows=original.paragraphs
    .map((p,i)=>[p.text,translation.paragraphs[i].text])
    .filter(([a])=>a.trim());
  if(rows.length){
    blocks.push({heading:'Полный текст распознавания — включая дополнительные отметки'});
    blocks.push({table:[['Оригинал','Перевод'],...rows]});
  }
  return blocks;
}

function buildBlocks(original,translation,paired) {
  if (translation.template === 'apostille') validateApostille(translation.elements, translation.language, true);
  if (!paired && translation.template === 'apostille') return apostilleBlocks(translation);
  return paired ? pairedLayoutBlocks(original,translation) : layoutBlocks(translation);
}
// Заголовок документа над самим переводом. Раньше здесь всегда стояло
// либо имя загруженного файла (original.name/translation.name — то же
// самое, что видно в поле "Файл" на панели), либо литеральное слово
// "APOSTILLE". Для Аттестата это давало на выходе строку вида
// "ea2d75-attestat-osobogo-obrazca-1591798694.jpg" поверх уже готового
// связного заголовка документа (см. attestatBlocks ниже) — то есть имя
// файла попадало в перевод, которого там быть не должно (Ethan, 18 сен
// 2026, живой кейс с реальным аттестатом). Для непарного (paired=false —
// именно так вкладка "Перевод" всегда и экспортирует, см. panel.js)
// апостиля тоже убираем: apostilleBlocks() уже сама печатает заголовок
// "APOSTILLE" внутри таблицы (title/subtitle), второй такой же сверху —
// чистое дублирование (в .docx/.html он и так не показывался — только
// в .txt эта дублирующая строка раньше пролезала, здесь заодно выровняли).
function documentTitle(name, translation, paired) {
  if (translation.docType === 'Аттестат') return '';
  if (!paired && translation.template === 'apostille') return '';
  return paired ? name : translation.name;
}
const txtCell = c => (c && c.__bi) ? `${c.a} → ${c.b}` : String(c);
export function buildTranslationTxt(original,translation,paired,certification) {
  const title = documentTitle(original.name, translation, paired);
  const blocks = [...buildBlocks(original,translation,paired), ...certificationBlocks(certification, translation.language)];
  const body = blocks.map(b=>(b.subtitle ? b.subtitle+'\n' : '')+(b.table?b.table.map(row=>row.map(txtCell).join('\t')).join('\n'):(b.heading||b.text))).join('\n');
  return title ? `${title}\n\n${body}` : body;
}
export function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function safeName(name) {return name.replace(/[\\/:*?"<>|\u0000-\u001F]/g,'_').slice(0,100)||'document';}
export function exportTxt(original,translation,paired,certification) {
  downloadBlob(new Blob([buildTranslationTxt(original,translation,paired,certification)],{type:'text/plain;charset=utf-8'}),safeName(original.name)+'-translation.txt');
}
const paragraph = (text,heading=false) => '<w:p><w:pPr><w:spacing w:before="'+(heading?'180':'0')+'" w:after="80" w:line="260" w:lineRule="auto"/><w:widowControl/>'+(heading?'<w:keepNext/>':'')+'</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="SimSun"/><w:sz w:val="'+(heading?'24':'22')+'"/>'+(heading?'<w:b/>':'')+'</w:rPr><w:t xml:space="preserve">'+escapeXml(text).replace(/\r?\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>';
// A bilingual cell renders as two stacked paragraphs in the same table cell:
// the original at normal weight, the translated line beneath it in italic
// grey with a "→" marker — same convention as the print/screen view, so the
// exported document reads the same way it was reviewed.
const translatedRun = text => '<w:p><w:pPr><w:spacing w:before="20" w:after="80" w:line="260" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="SimSun"/><w:sz w:val="20"/><w:i/><w:color w:val="555555"/></w:rPr><w:t xml:space="preserve">'+escapeXml(text).replace(/\r?\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>';
const cellXml = cell => (cell && cell.__bi) ? paragraph(cell.a)+translatedRun('→ '+cell.b) : paragraph(cell);
const alignedParagraph = (text, heading = false, center = false) => paragraph(text, heading).replace('<w:pPr>', '<w:pPr>'+(center ? '<w:jc w:val="center"/>' : ''));
const table = (rows, widths, options = {}) => {
  const properties = widths
    ? '<w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
    : '<w:tblW w:w="0" w:type="auto"/>';
  const grid = widths ? '<w:tblGrid>'+widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('')+'</w:tblGrid>' : '';
  const borders = ['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="${options.borderless ? 'nil' : 'single'}" w:sz="4" w:color="000000"/>`).join('');
  const header = options.title ? '<w:tr><w:tc><w:tcPr><w:tcW w:w="9638" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr>'+alignedParagraph(options.title,true,true)+alignedParagraph(options.subtitle,true,true)+'</w:tc></w:tr>' : '';
  const body = rows.map(row=>'<w:tr><w:trPr><w:cantSplit/></w:trPr>'+row.map((cell,index)=>'<w:tc><w:tcPr>'+(widths ? `<w:tcW w:w="${widths[index]}" w:type="dxa"/>` : '<w:tcW w:w="0" w:type="auto"/>')+'<w:vAlign w:val="center"/></w:tcPr>'+(options.apostille ? alignedParagraph(cell, false, index === 1) : cellXml(cell))+'</w:tc>').join('')+'</w:tr>').join('');
  return '<w:tbl><w:tblPr>'+properties+'<w:tblBorders>'+borders+'</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>'+grid+header+body+'</w:tbl>';
};
export function buildDocumentXml(original,translation,paired,certification) {
  // Аттестат в .docx получает свою настоящую вёрстку (шрифт Times New
  // Roman, пунктирные рамки таблиц предметов/экзаменов) вместо общего
  // рендера — см. attestatDocx.mjs. Только для непарного экспорта: именно
  // так вкладка "Перевод" всегда и экспортирует (paired=false, см.
  // panel.js); парный/двуязычный режим этой вёрстки пока не имеет — если
  // понадобится, это отдельная задача.
  if (!paired && translation.docType === 'Аттестат') return buildAttestatDocumentXml(translation, certification);
  // То же самое для типа "Паспорт / удостоверение личности" (ID-карта КР
  // и аналогичные документы личности) — см. комментарий в idCardDocx.mjs.
  // (Есть реальный образец от бюро для этого типа тоже, MRZ ВОСПРОИЗВОДИТСЯ
  // — старый комментарий здесь был не обновлён после того, как это
  // изменилось; см. idCardDocx.mjs.)
  if (!paired && translation.docType === 'Паспорт / удостоверение личности') return buildIdCardDocumentXml(translation, certification);
  // "Паспорт Канады" — отдельный тип со своей вёрсткой (не вариант этой же
  // ID-карты) — см. passportCanadaDocx.mjs.
  if (!paired && translation.docType === 'Паспорт Канады') return buildPassportCanadaDocumentXml(translation, certification);
  // "Паспорт Узбекистана (старого образца)" / "(биометрический)" — два
  // отдельных типа со своей вёрсткой каждый (не варианты ID-карты) — см.
  // passportUzbekistanOldDocx.mjs / passportUzbekistanDocx.mjs.
  if (!paired && translation.docType === 'Паспорт Узбекистана (старого образца)') return buildPassportUzbekistanOldDocumentXml(translation, certification);
  if (!paired && translation.docType === 'Паспорт Узбекистана (биометрический)') return buildPassportUzbekistanDocumentXml(translation, certification);
  const title = documentTitle(original.name, translation, paired);
  let body = title ? paragraph(title,true) : '';
  const blocks = [...buildBlocks(original,translation,paired), ...certificationBlocks(certification, translation.language)];
  for (const b of blocks) body+=b.table?table(b.table,b.widths,b):paragraph(b.heading||b.text,!!b.heading);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
export async function exportDocx(original,translation,paired,certification) {
  if (!globalThis.JSZip) throw new Error('Модуль DOCX не загрузился. Обновите страницу.');
  const zip=new globalThis.JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml',buildDocumentXml(original,translation,paired,certification));
  downloadBlob(await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),safeName(original.name)+'-translation.docx');
}
const cellHtml = cell => (cell && cell.__bi)
  ? escapeXml(cell.a)+'<br><span class="tr">→ '+escapeXml(cell.b)+'</span>'
  : escapeXml(cell);
export function buildTranslationHtmlBody(original, translation, paired, certification) {
  const titleText = documentTitle(original.name, translation, paired);
  const title = titleText ? '<h1>'+escapeXml(titleText)+'</h1>' : '';
  const blocks = [...buildBlocks(original,translation,paired), ...certificationBlocks(certification, translation.language)];
  return title+blocks.map(b => {
    if (!b.table) return b.heading ? '<h3>'+escapeXml(b.heading)+'</h3>' : '<p>'+escapeXml(b.text)+'</p>';
    const header = b.title ? '<tr><td colspan="2" style="text-align:center;font-size:16pt;font-weight:bold">'+escapeXml(b.title)+'<br>'+escapeXml(b.subtitle)+'</td></tr>' : '';
    const cols = b.widths ? '<colgroup>'+b.widths.map(w=>`<col style="width:${w/9638*100}%">`).join('')+'</colgroup>' : '';
    return (b.apostille ? '<table style="width:100%;border-collapse:collapse;table-layout:fixed">' : '<table>')+cols+header+b.table.map(row=>'<tr>'+row.map((cell,i)=>'<td style="border:'+(b.borderless?'0':'1px solid #111')+';padding:7px;vertical-align:middle;white-space:pre-wrap;overflow-wrap:anywhere;text-align:'+(b.apostille && i === 1?'center':'left')+'">'+cellHtml(cell)+'</td>').join('')+'</tr>').join('')+'</table>';
  }).join('');
}
export function buildPrintHtml(original,translation,paired,certification) {
  return '<!doctype html><html lang="'+escapeXml(translation.language || 'ru')+'"><meta charset="utf-8"><title>Translation</title><style>body{font:11pt Arial,sans-serif;line-height:1.3;margin:24px;color:#111}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:6pt 0}h1{font-size:18pt}h3{font-size:11pt;margin:14pt 0 6pt}table{width:100%;border-collapse:collapse;table-layout:fixed}td{border:1px solid #111;padding:7px}.tr{color:#555;font-style:italic}tr{break-inside:avoid}@page{size:A4;margin:18mm}</style>'+buildTranslationHtmlBody(original,translation,paired,certification)+'</html>';
}
export function printTranslation(original,translation,paired,certification) {
  const win=window.open('','_blank');
  if(!win)throw new Error('Разрешите открытие окна печати.');
  win.opener=null;win.document.write(buildPrintHtml(original,translation,paired,certification));win.document.close();
  const button=win.document.createElement('button');button.textContent='Печать / сохранить PDF';button.onclick=()=>win.print();win.document.body.prepend(button);
}

export async function downloadTranslationPdf(translation,certification) {
  if (translation.template === 'apostille') validateApostille(translation.elements, translation.language, true);
  if (!globalThis.html2canvas || !globalThis.jspdf?.jsPDF) {
    throw new Error('Модуль PDF не загрузился. Обновите страницу и повторите попытку.');
  }
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:720px;padding:44px;background:#fff;color:#111;font:16px Arial,sans-serif;line-height:1.35;';
  // Reuse the same block builder as print/DOCX/TXT export (buildTranslationHtmlBody)
  // instead of hand-building a fields-only table here: the old custom container
  // only ever rendered translation.fields, silently dropping subject/grade
  // tables and recognized paragraphs from the direct PDF download.
  container.innerHTML = buildTranslationHtmlBody(translation, translation, false, certification);
  document.body.append(container);
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Safe page-break points: bottom edge of every top-level block (h1/h3/p/
    // table) plus every table row, measured in the live DOM before rasterizing.
    // Without this, a fixed-pixel slice through the canvas could land mid-
    // paragraph or mid-row, cutting text in half across the page boundary
    // (Ethan, 18 сен 2026, live PDF export). A block taller than one page (rare)
    // has no safe break inside the page window, so that page falls back to a
    // hard cut at the page boundary, same as before.
    const containerRect = container.getBoundingClientRect();
    const breakEls = [...container.children, ...container.querySelectorAll('tr')];
    const rawBreaks = breakEls.map(el => el.getBoundingClientRect().bottom - containerRect.top);
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#fff' });
    const { jsPDF } = globalThis.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 30;
    const width = 595.28 - margin * 2;
    const height = 841.89 - margin * 2;
    const scale = width / canvas.width;
    const pageHeight = Math.floor(height / scale);
    const factor = canvas.width / containerRect.width;
    const breakPoints = rawBreaks
      .map(b => Math.round(b * factor))
      .filter(v => v > 0 && v < canvas.height)
      .sort((a, b) => a - b);
    let offset = 0;
    let first = true;
    while (offset < canvas.height) {
      const maxEnd = Math.min(offset + pageHeight, canvas.height);
      let end = maxEnd;
      if (maxEnd < canvas.height) {
        for (const bp of breakPoints) {
          if (bp > offset && bp <= maxEnd) end = bp;
          else if (bp > maxEnd) break;
        }
      }
      const sliceHeight = end - offset;
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceHeight;
      slice.getContext('2d').drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', margin, margin, width, sliceHeight * scale);
      first = false;
      offset += sliceHeight;
    }
    const name = safeName(translation.name || 'translation').replace(/\.[^.]+$/, '');
    pdf.save(`${name}-translation.pdf`);
  } finally {
    container.remove();
  }
}
