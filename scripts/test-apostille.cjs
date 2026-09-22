const { test } = require('node:test');
const assert = require('node:assert/strict');
const { APOSTILLE_FIELDS } = require('../lib/translationDocs/apostille');
const labels = ['国家', '本公文', '签署人', '身份/职务', '加盖的印章/印鉴', '认证', '地点', '日期', '认证机关', '编号', '印章/印鉴', '签名'];
function document() {
  const values = ['吉尔吉斯共和国', '', 'Amanova G.', '负责人', '民事身份登记机关', '', '比什凯克市', '30-01-2018', '楚河-比什凯克区域司法局', '54-1', '[印章]', 'Zh. R. Ismailov'];
  return { name: 'test', template: 'apostille', language: 'zh', fields: [], columns: [], items: [], paragraphs: [], elements: APOSTILLE_FIELDS.map((f, i) => ({ key: f.key, elementType: f.elementType || 'numbered_field', number: f.number || '', label: labels[i], value: values[i], sourceValue: values[i] })) };
}
test('all text exports retain ten fields and unnumbered headings', async () => {
  const { buildTranslationTxt, buildDocumentXml, buildPrintHtml } = await import('../public/js/translation/export.mjs');
  for (const render of [buildTranslationTxt, buildDocumentXml, buildPrintHtml]) {
    const doc = document();
    const text = render(doc, doc, false);
    assert.match(text, /9\. 印章\/印鉴/);
    assert.match(text, /10\. 签名/);
    assert.doesNotMatch(text, /(?:11|12)\.|\d\. (?:本公文|认证)[<\t]/);
  }
});
test('all ten fields including signature share one table with separate unnumbered headings', async () => {
  const { buildDocumentXml, buildTranslationTxt, buildPrintHtml } = await import('../public/js/translation/export.mjs');
  const doc = document();
  const xml = buildDocumentXml(doc, doc, false);
  const rows = xml.match(/<w:tr>.*?<\/w:tr>/g);
  assert.equal(rows.length, 13);
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 1);
  assert.match(rows[2], /本公文/);
  assert.match(rows[6], /认证/);
  assert.doesNotMatch(rows[2] + rows[6], /\d\. /);
  assert.doesNotMatch(rows[1] + rows[5], /\((?:本公文|认证)\)/);
  assert.match(rows[12], /10\. 签名/);
  assert.equal((rows[0].match(/<w:tc>/g) || []).length, 1);
  assert.match(rows[0], /<w:gridSpan w:val="2"\/>/);
  for (const row of rows.slice(1)) assert.equal((row.match(/<w:tc>/g) || []).length, 2);
  assert.match(xml, /<w:tblLayout w:type="fixed"\/>/);
  assert.match(xml, /<w:tblGrid><w:gridCol w:w="3010"\/><w:gridCol w:w="6628"\/><\/w:tblGrid>/);
  for (const render of [buildDocumentXml, buildTranslationTxt, buildPrintHtml]) {
    assert.equal((render(doc, doc, false).match(/APOSTILLE/g) || []).length, 1);
  }
});
test('exports fail closed for absent structure, shifted numbers, changed names and Pechat', async () => {
  const { buildTranslationTxt } = await import('../public/js/translation/export.mjs');
  for (const corrupt of [d => delete d.elements, d => d.elements[1].number = '2', d => d.elements[11].number = '12', d => d.elements[2].value = 'Amanova T.', d => d.elements[10].value = 'Pechat', d => d.elements[4].value = 'Zharandyk abaldyn aktylaryn kattoo bolumu']) {
    const doc = document(); corrupt(doc);
    assert.throws(() => buildTranslationTxt(doc, doc, false), /apostille|\u0430\u043f\u043e\u0441\u0442\u0438\u043b/i);
  }
});
test('readable stamp text remains separate and unnumbered', async () => {
  const { buildTranslationTxt } = await import('../public/js/translation/export.mjs');
  const doc = document();
  doc.elements.push({ key: 'stamp_text_1', elementType: 'stamp_text', number: '', label: '', value: '司法部' });
  assert.match(buildTranslationTxt(doc, doc, false), /司法部/);
});
test('PDF rejects invalid numbering before creating a canvas', async () => {
  const { downloadTranslationPdf } = await import('../public/js/translation/export.mjs');
  const doc = document(); doc.elements[10].number = '11';
  await assert.rejects(downloadTranslationPdf(doc), /apostille|\u0430\u043f\u043e\u0441\u0442\u0438\u043b/i);
});
test('certification footer (translator\'s note) is absent by default, and — once a translator name is given — appears across all export formats as two compact paragraphs, target language first then source language, matching the real bureau reference ("аттестат 9.docx", Ethan, 18 сен 2026); the earlier per-field bilingual layout with the статья 87 legal citation and the notary-stamp placeholder box is gone', async () => {
  const { buildTranslationTxt, buildDocumentXml, buildTranslationHtmlBody, certificationBlocks } = await import('../public/js/translation/export.mjs');
  const doc = document();
  assert.deepEqual(certificationBlocks(undefined, 'zh'), [], 'no translator name → no footer at all');
  assert.deepEqual(certificationBlocks({ translatorName: '  ' }, 'zh'), [], 'whitespace-only name is treated as absent');
  for (const render of [buildTranslationTxt, buildDocumentXml, buildTranslationHtmlBody]) {
    const withoutFooter = render(doc, doc, false);
    assert.doesNotMatch(withoutFooter, /Достоверность перевода подтверждается|特此证明翻译准确无误|Иванова А\.Б\./);
    // doc.language === 'zh' (target), sourceLanguage passed below is 'ky' (original)
    const withFooter = render(doc, doc, false, { translatorName: 'Иванова А.Б.', sourceLanguage: 'ky' });
    // Ethan, 22 сен 2026: ФИО (и компания/адрес/e-mail, см. отдельный тест
    // ниже) теперь транслитерируется ПОД АЛФАВИТ КАЖДОГО абзаца — китайский
    // считается "латинской" целью для транслитерации (та же логика, что уже
    // применяется к ФИО в самом документе, field-rules.mjs), поэтому в
    // китайском абзаце имя выходит как "Ivanova A.B.", а не сырой кириллицей.
    assert.match(withFooter, /Ivanova A\.B\./);
    assert.doesNotMatch(withFooter, /本翻译由译者Иванова А\.Б\./, 'zh paragraph must not keep the raw Cyrillic name');
    // Целевой язык (zh) первым: имя языков в самом предложении на китайском,
    // не жёстко на русском (иначе получилось бы "from Кыргызский into
    // Китайский" посреди китайского/английского текста).
    assert.match(withFooter, /本翻译由译者Ivanova A\.B\.将吉尔吉斯语译为中文/);
    assert.match(withFooter, /特此证明翻译准确无误/);
    // Язык оригинала (ky) вторым.
    assert.match(withFooter, /Бул котормо кыргыз тилинен кытай тилине котормочу Иванова А\.Б\. тарабынан аткарылды/);
    assert.match(withFooter, /Котормонун тактыгы ушул менен күбөлөндүрүлөт/);
    // Порядок: язык перевода (реципиент документа) идёт первым абзацем, язык
    // оригинала — вторым (см. комментарий в certificationBlocks выше).
    assert.ok(withFooter.indexOf('特此证明翻译准确无误') < withFooter.indexOf('Котормонун тактыгы'), 'target-language paragraph must come before source-language paragraph');
    // Старый формат (заголовок, ссылка на статью закона, рамка под печать
    // нотариуса, отдельные подписи на ky/zh) полностью убран под реальный
    // образец бюро переводов — см. certificationBlocks выше.
    assert.doesNotMatch(withFooter, /Удостоверение переводчика/);
    assert.doesNotMatch(withFooter, /статья 87/);
    assert.doesNotMatch(withFooter, /Место для удостоверительной надписи/);
    assert.doesNotMatch(withFooter, /Котормочунун колу/);
    assert.doesNotMatch(withFooter, /译者签名/);
  }
});

test('certification footer: company name/address/e-mail are transliterated to match EACH paragraph\'s own alphabet, not left as raw Cyrillic in the Latin-target paragraph', async () => {
  // Реальный репорт, Ethan, 22 сен 2026: в абзаце на английском языке
  // компания/адрес/e-mail оставались кириллицей как есть, хотя ФИО
  // переводчика в остальном документе уже транслитерируется.
  const { certificationBlocks } = await import('../public/js/translation/export.mjs');
  const certification = {
    translatorName: 'Иванова А.Б.',
    sourceLanguage: 'ru',
    companyName: 'Компания Тест',
    address: 'Бишкек, ул. Тестовая 1',
    email: 'тест'
  };
  const [targetParagraph, sourceParagraph] = certificationBlocks(certification, 'en');
  // Целевой абзац — английский: латиница везде, ни одной кириллической буквы
  // в транслитерируемых полях не должно остаться.
  assert.match(targetParagraph.text, /Kompaniia Test/);
  assert.match(targetParagraph.text, /Bishkek, ul\. Testovaia 1/);
  assert.match(targetParagraph.text, /E-mail: test\b/);
  assert.match(targetParagraph.text, /Ivanova A\.B\./);
  assert.doesNotMatch(targetParagraph.text, /Компания Тест|Бишкек|тест[^A-Za-z]/, 'no raw Cyrillic should remain in the Latin-target paragraph');
  // Абзац языка оригинала — русский: значения остаются как были введены
  // (уже кириллица, транслитерировать в кириллицу из кириллицы — no-op).
  assert.match(sourceParagraph.text, /Компания Тест/);
  assert.match(sourceParagraph.text, /Бишкек, ул\. Тестовая 1/);
  assert.match(sourceParagraph.text, /Иванова А\.Б\./);
});

test('buildExportDocs threads doc.result.paragraphs through to original/translation.paragraphs, in order, and the paired bilingual export renders them side by side', async () => {
  const { buildExportDocs } = await import('../public/js/translationDocs/export-model.mjs');
  const { buildTranslationTxt, pairedLayoutBlocks } = await import('../public/js/translation/export.mjs');
  const doc = {
    file: { name: 'contract.png' },
    result: {
      doc_type: 'Другое',
      fields: [{ label: 'Номер', value: '', targetLabel: 'Номер', translated: '' }],
      paragraphs: [
        { text: 'Первый абзац договора.', translated: 'First paragraph of the contract.' },
        { text: 'Второй абзац, со ссылкой на приложение.', translated: 'Second paragraph, referencing the annex.' }
      ]
    }
  };
  const { original, translation } = buildExportDocs(doc, 'en');
  assert.deepEqual(original.paragraphs, [{ text: 'Первый абзац договора.' }, { text: 'Второй абзац, со ссылкой на приложение.' }]);
  assert.deepEqual(translation.paragraphs, [{ text: 'First paragraph of the contract.' }, { text: 'Second paragraph, referencing the annex.' }]);
  const blocks = pairedLayoutBlocks(original, translation);
  const textBlock = blocks.find(b => b.table && b.table[0][0] === 'Оригинал');
  assert.equal(textBlock.table.length, 3); // header + 2 paragraphs, same order, nothing dropped
  assert.deepEqual(textBlock.table[1], ['Первый абзац договора.', 'First paragraph of the contract.']);
  assert.deepEqual(textBlock.table[2], ['Второй абзац, со ссылкой на приложение.', 'Second paragraph, referencing the annex.']);
  const txt = buildTranslationTxt(original, translation, true);
  assert.ok(txt.includes('Первый абзац договора.'));
  assert.ok(txt.includes('First paragraph of the contract.'));
});

test('signature marker localization preserves every character of the name', async () => {
  const { apostilleSignature, validateApostille } = await import('../public/js/translation/apostille.mjs');
  const doc = document();
  const signature = doc.elements.at(-1);
  signature.sourceValue = 'Zh. R. Ismailov\n[signature]';
  signature.value = apostilleSignature(signature.sourceValue, 'zh');
  assert.equal(signature.value, 'Zh. R. Ismailov\n【签字】');
  assert.doesNotThrow(() => validateApostille(doc.elements, 'zh', true));
});
test('API element types survive panel conversion and can be downloaded', async () => {
  const { buildExportDocs } = await import('../public/js/translationDocs/export-model.mjs');
  const { buildDocumentXml, buildTranslationTxt, buildPrintHtml } = await import('../public/js/translation/export.mjs');
  const fixture = document();
  // client-recognize serializes elementType as type and empty numbers as null.
  const elements = fixture.elements.map(e => ({ key: e.key, type: e.elementType, number: e.number || null, label: e.label, targetLabel: e.label, value: e.value, translated: e.value }));
  const doc = { file: { name: 'apostille.png' }, result: { doc_type: 'apostille', fields: elements.map(e => ({ ...e })), elements } };
  const { original, translation } = buildExportDocs(doc, 'zh');
  for (const render of [buildDocumentXml, buildTranslationTxt, buildPrintHtml]) {
    assert.doesNotThrow(() => render(original, translation, false));
  }
  translation.elements[10].number = '11';
  assert.throws(() => buildDocumentXml(original, translation, false), /apostille|\u0430\u043f\u043e\u0441\u0442\u0438\u043b/i);
});
test('export accepts deterministic transliteration and DD-MM-YY dates, but rejects changed IDs', async () => {
  const { validateApostille } = await import('../public/js/translation/apostille.mjs');
  const doc = document();
  Object.assign(doc.elements[2], { sourceValue: 'Алманова Т.', value: 'Almanova T.' });
  Object.assign(doc.elements[7], { sourceValue: '30.01.2018-ж.', value: '30-01-2018' });
  Object.assign(doc.elements[11], { sourceValue: 'Ж.Р. Исмаилов [signature]', value: 'Zh.R. Ismailov 【签字】' });
  assert.doesNotThrow(() => validateApostille(doc.elements, 'zh', true));
  doc.elements[9].value = '54-2';
  assert.throws(() => validateApostille(doc.elements, 'zh', true));
});
test('reviewed source corrections are used instead of stale extracted names', async () => {
  const { buildExportDocs } = await import('../public/js/translationDocs/export-model.mjs');
  const { buildDocumentXml } = await import('../public/js/translation/export.mjs');
  const fixture = document();
  const fields = fixture.elements.map(e => ({ ...e, targetLabel: e.label, translated: e.value }));
  fields[2].value = 'Алманова Г.'; fields[2].translated = 'Almanova G.';
  const { original, translation } = buildExportDocs({ file: { name: 'reviewed.png' }, result: { doc_type: 'apostille', fields, elements: fixture.elements } }, 'zh');
  assert.match(buildDocumentXml(original, translation, false), /Almanova G\./);
});
// "ПАВЛОВИЧ" давало "PAVLOVICh" — заглавная буква с многобуквенным
// соответствием капитализировалась как начало слова, даже внутри слова
// ЗАГЛАВНЫМИ (Ethan, 20 сен 2026, живой кейс).
test('transliteration keeps case: ALL-CAPS words stay upper case, title-case words and initials stay Title-case', async () => {
  const { transliterateName } = await import('../public/js/translation/field-rules.mjs');
  const { transliterate } = await import('../public/js/translation/model.mjs');
  const cases = {
    'ПАВЛОВИЧ': 'PAVLOVICH', 'ШИРИНОВ ЖУМАБЕК': 'SHIRINOV ZHUMABEK', 'ИВАНОВА МАРИЯ ПЕТРОВНА': 'IVANOVA MARIIA PETROVNA',
    'Павлович': 'Pavlovich', 'Чингиз Шаршенов': 'Chingiz Sharshenov', 'Ж. Р. Исмаилов': 'Zh. R. Ismailov', 'ЩУКИН-ЧАЙКА': 'SHCHUKIN-CHAIKA'
  };
  for (const [source, expected] of Object.entries(cases)) {
    assert.equal(transliterateName(source, 'en'), expected, source);
    assert.equal(transliterate(source, 'en'), expected, source);
  }
});
// Латиница → кириллица: "y" между согласными — "ы" (Ethan, 19 сен 2026:
// "ADYLOVICH" превращалось в "АДИЛОВИЧ"), в остальных позициях — по-прежнему "и".
test('Latin to Cyrillic transliteration: y between consonants is "ы", elsewhere "и"', async () => {
  const { transliterateName } = await import('../public/js/translation/field-rules.mjs');
  const cases = { 'ADYLOVICH': 'АДЫЛОВИЧ', 'Bektybek': 'Бектыбек', 'SADYRBAEVA': 'САДЫРБАЕВА', 'Mary': 'Мари', 'Kimberly': 'Кимберли', 'Yuri': 'Юри', 'Yan': 'Ян' };
  for (const [source, expected] of Object.entries(cases)) assert.equal(transliterateName(source, 'ru'), expected, source);
});
test('date formats and status colors match the requested rules', async () => {
  const { normalizeDate, apostilleValue, TRANSLATION_STATUSES } = await import('../public/js/translation/field-rules.mjs');
  for (const text of ['30.01.2018-ж.', '2018-01-30', '30/01/18', '30-01-2018']) assert.equal(normalizeDate(text), '30-01-2018');
  assert.equal(normalizeDate('[unclear]'), '[unclear]');
  assert.equal(apostilleValue('apostille_number', 'KG-0054/1', 'zh').value, 'KG-0054/1');
  assert.equal(apostilleValue('signatory_name', 'Amanova G.', 'zh').status, 'preserved');
  assert.equal(TRANSLATION_STATUSES.translated[1], '#18794e');
  assert.equal(TRANSLATION_STATUSES.transliterated[1], '#7c3aed');
  assert.equal(TRANSLATION_STATUSES.preserved[1], '#64748b');
});
// Даты словом на языках исходных документов (Ethan, 20 сен 2026, живой кейс:
// свидетельство о рождении, "27 января 1991 года" оставалось как есть).
test('dates written with month names (ru/ky/kk/uz) become DD-MM-YYYY, the trailing "года/г./жылы" is dropped, time is kept', async () => {
  const { normalizeDate } = await import('../public/js/translation/field-rules.mjs');
  const cases = {
    '27 января 1991 года': '27-01-1991', '24 апреля 2012 г.': '24-04-2012', '1 марта 2020': '01-03-2020', '12 сентября 1999': '12-09-1999',
    '27-январь 1991-ж.': '27-01-1991', '27 қаңтар 1991 ж.': '27-01-1991', '27 yanvar 1991': '27-01-1991',
    '5 мая 2001 года, 10:49:39 (GMT+6)': '05-05-2001, 10:49:39 (GMT+6)'
  };
  for (const [source, expected] of Object.entries(cases)) assert.equal(normalizeDate(source), expected, source);
  // канадский паспорт: английский/французский месяц через "/", год двумя цифрами
  for (const [source, expected] of Object.entries({ '05 MAY /MAI 79': '05-05-1979', '05 MAY/MAI 79': '05-05-1979', '01 AUG/AOÛT 1990': '01-08-1990', '14 JAN/JAN 23': '14-01-2023' })) assert.equal(normalizeDate(source), expected, source);
  // двузначный год: до +10 лет от текущего — 20xx (срок действия), дальше — 19xx (дата рождения)
  const thisYear = new Date().getFullYear();
  assert.equal(normalizeDate(`01 JAN/JAN ${String(thisYear + 10).slice(-2)}`), `01-01-${thisYear + 10}`);
  assert.equal(normalizeDate(`01 JAN/JAN ${String(thisYear + 11).slice(-2)}`), `01-01-${thisYear - 89}`);
  // не месяц — не трогаем
  assert.equal(normalizeDate('27 Xyz 1991'), '27 Xyz 1991');
});
test('uncertain names require explicit review, and editing invalidates the confirmation', async () => {
  const { buildExportDocs } = await import('../public/js/translationDocs/export-model.mjs');
  const { buildTranslationTxt } = await import('../public/js/translation/export.mjs');
  const fixture = document();
  const fields = fixture.elements.map(e => ({ ...e, translated: e.value }));
  fields[2].requiresReview = true;
  const doc = { file: { name: 'test' }, result: { doc_type: 'apostille', fields, elements: fixture.elements } };
  const render = () => { const { original, translation } = buildExportDocs(doc, 'zh'); return buildTranslationTxt(original, translation, false); };
  assert.throws(render, /требует сверки/);
  fields[2].reviewedSource = fields[2].value; fields[2].reviewedTranslation = fields[2].translated;
  assert.doesNotThrow(render);
  fields[2].value = 'Amanova T.'; fields[2].translated = 'Amanova T.';
  assert.throws(render, /требует сверки/);
});
test('PDF renders the same apostille layout and reaches save without validation errors', async () => {
  const { downloadTranslationPdf, buildTranslationHtmlBody } = await import('../public/js/translation/export.mjs');
  const fixture = document();
  const saved = Object.fromEntries(['document', 'html2canvas', 'jspdf', 'requestAnimationFrame'].map(k => [k, global[k]]));
  let container, savedName, removed = false, addedImage = false;
  global.document = {
    body: { append(node) { container = node; } },
    createElement(tag) {
      return tag === 'canvas'
        ? { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,test' }
        : { style: {}, innerHTML: '', children: [], querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, width: 720 }), remove() { removed = true; } };
    }
  };
  global.requestAnimationFrame = callback => callback();
  global.html2canvas = async node => {
    assert.equal(node.innerHTML, buildTranslationHtmlBody(fixture, fixture, false));
    assert.match(node.innerHTML, /colspan="2"/);
    return { width: 1440, height: 1500 };
  };
  global.jspdf = { jsPDF: class { addImage() { addedImage = true; } addPage() {} save(name) { savedName = name; } } };
  try {
    await downloadTranslationPdf(fixture);
    assert.ok(container && addedImage && removed);
    assert.equal(savedName, 'test-translation.pdf');
  } finally { Object.assign(global, saved); }
});
