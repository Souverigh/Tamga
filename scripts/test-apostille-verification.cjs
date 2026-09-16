const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const clientPath = require.resolve('../lib/geminiClient');
let answer;
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { callGemini: async request => { assert.ok(!request.instruction.includes('Amanova')); return answer; } } };
const fields = () => ({ signatory_name: { value: 'Amanova G.', confidence: 96 }, certified_date: { value: '30.01.2018', confidence: 96 }, apostille_number: { value: '54-1', confidence: 96 }, signature: { value: 'Ismailov [signature]', confidence: 96 } });
test('independent reread flags a changed initial without replacing source', async () => {
  const { verifyApostilleValues } = require('../lib/translationDocs/verification');
  const data = fields();
  answer = { result: { checks: Object.entries(data).map(([key, f]) => ({ key, value: key === 'signatory_name' ? 'Amanova T.' : f.value, confidence: 97 })) } };
  await verifyApostilleValues({ fieldsByKey: data, base64: 'scan', mimeType: 'image/png', apiKey: 'test' });
  assert.equal(data.signatory_name.value, 'Amanova G.');
  assert.equal(data.signatory_name.requiresReview, true);
  assert.equal(data.signatory_name.verificationCandidate, 'Amanova T.');
  assert.equal(data.apostille_number.requiresReview, false);
});
test('low confidence or incomplete reread cannot silently approve critical values', async () => {
  const { verifyApostilleValues } = require('../lib/translationDocs/verification');
  const data = fields();
  answer = { result: { checks: [{ key: 'signatory_name', value: 'Amanova G.', confidence: 55 }] } };
  await verifyApostilleValues({ fieldsByKey: data, base64: 'scan', mimeType: 'image/png', apiKey: 'test' });
  assert.equal(data.signatory_name.requiresReview, true);
  assert.equal(data.apostille_number.requiresReview, true);
});
