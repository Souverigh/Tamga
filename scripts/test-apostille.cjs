const { test } = require('node:test');
const assert = require('node:assert/strict');
const { APOSTILLE_FIELDS } = require('../lib/translationDocs/apostille');
const labels = ['国家', '本公文', '签署人', '身份/职务', '加盖的印章/印鉴', '认证', '地点', '日期', '认证机关', '编号', '印章/印鉴', '签名'];
function document() {
  const values = ['吉尔吉斯共和国', '', 'Amanova G.', '负责人', '民事身份登记机关', '', '比什凯克市', '30-01-18', '楚河-比什凯克区域司法局', '54-1', '[印章]', 'Zh. R. Ismailov'];
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
test('certification footer (translator name/language pair/signature line) is absent by default and appears across all export formats when a translator name is given', async () => {
  const { buildTranslationTxt, buildDocumentXml, buildTranslationHtmlBody, certificationBlocks } = await import('../public/js/translation/export.mjs');
  const doc = document();
  assert.deepEqual(certificationBlocks(undefined, 'zh'), [], 'no translator name → no footer at all');
  assert.deepEqual(certificationBlocks({ translatorName: '  ' }, 'zh'), [], 'whitespace-only name is treated as absent');
  for (const render of [buildTranslationTxt, buildDocumentXml, buildTranslationHtmlBody]) {
    const withoutFooter = render(doc, doc, false);
    assert.doesNotMatch(withoutFooter, /Удостоверение переводчика/);
    const withFooter = render(doc, doc, false, { translatorName: 'Иванова А.Б.', sourceLanguage: 'ky' });
    assert.match(withFooter, /Удостоверение переводчика/);
    assert.match(withFooter, /Иванова А\.Б\./);
    assert.match(withFooter, /Кыргызский/); // язык оригинала
    assert.match(withFooter, /Китайский/); // язык перевода (doc.language === 'zh')
    assert.match(withFooter, /Подпись/);
  }
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
  Object.assign(doc.elements[7], { sourceValue: '30.01.2018-ж.', value: '30-01-18' });
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
test('date formats and status colors match the requested rules', async () => {
  const { normalizeDate, apostilleValue, TRANSLATION_STATUSES } = await import('../public/js/translation/field-rules.mjs');
  for (const text of ['30.01.2018-ж.', '2018-01-30', '30/01/18', '30-01-18']) assert.equal(normalizeDate(text), '30-01-18');
  assert.equal(normalizeDate('[unclear]'), '[unclear]');
  assert.equal(apostilleValue('apostille_number', 'KG-0054/1', 'zh').value, 'KG-0054/1');
  assert.equal(apostilleValue('signatory_name', 'Amanova G.', 'zh').status, 'preserved');
  assert.equal(TRANSLATION_STATUSES.translated[1], '#18794e');
  assert.equal(TRANSLATION_STATUSES.transliterated[1], '#7c3aed');
  assert.equal(TRANSLATION_STATUSES.preserved[1], '#64748b');
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
        : { style: {}, innerHTML: '', remove() { removed = true; } };
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
