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
test('Word uses twelve horizontal two-cell rows with stable column widths and one title', async () => {
  const { buildDocumentXml, buildTranslationTxt, buildPrintHtml } = await import('../public/js/translation/export.mjs');
  const doc = document();
  const xml = buildDocumentXml(doc, doc, false);
  const rows = xml.match(/<w:tr>.*?<\/w:tr>/g);
  assert.equal(rows.length, 12);
  for (const row of rows) assert.equal((row.match(/<w:tc>/g) || []).length, 2);
  assert.match(xml, /<w:tblLayout w:type="fixed"\/>/);
  assert.match(xml, /<w:tblGrid><w:gridCol w:w="4048"\/><w:gridCol w:w="5590"\/><\/w:tblGrid>/);
  for (const render of [buildDocumentXml, buildTranslationTxt, buildPrintHtml]) {
    assert.equal((render(doc, doc, false).match(/APOSTILLE/g) || []).length, 1);
  }
});
test('exports fail closed for absent structure, shifted numbers, changed names and Pechat', async () => {
  const { buildTranslationTxt } = await import('../public/js/translation/export.mjs');
  for (const corrupt of [d => delete d.elements, d => d.elements[1].number = '2', d => d.elements[11].number = '12', d => d.elements[2].value = 'Amanova T.', d => d.elements[10].value = 'Pechat', d => d.elements[4].value = 'Zharandyk abaldyn aktylaryn kattoo bolumu']) {
    const doc = document(); corrupt(doc);
    assert.throws(() => buildTranslationTxt(doc, doc, false), /apostille/i);
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
  await assert.rejects(downloadTranslationPdf(doc), /apostille/i);
});
test('signature marker localization preserves every character of the name', async () => {
  const { apostilleSignature, validateApostille } = await import('../public/js/translation/apostille.mjs');
  const doc = document();
  const signature = doc.elements.at(-1);
  signature.sourceValue = 'Zh. R. Ismailov\n[signature]';
  signature.value = apostilleSignature(signature.sourceValue, 'zh');
  assert.equal(signature.value, 'Zh. R. Ismailov\n[签字]');
  assert.doesNotThrow(() => validateApostille(doc.elements, 'zh', true));
});
