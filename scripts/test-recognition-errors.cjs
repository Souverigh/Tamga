const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('quota storage failure is not retried as Gemini overload', async () => {
  let requests = 0;
  let retries = 0;
  const context = vm.createContext({
    pageImageToBase64: () => 'image',
    setTimeout: fn => { fn(); return 1; }, clearTimeout() {},
    fetch: async () => {
      requests++;
      return { ok: false, status: 503, json: async () => ({
        error: 'Quota accounting unavailable', code: 'QUOTA_UNAVAILABLE',
      }) };
    },
  });
  const source = fs.readFileSync('public/js/api/geminiRecognizeClient.js', 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInContext(source, context);
  await assert.rejects(context.recognizeWithGemini('image', null, { onRetry: () => { retries++; } }), /Quota accounting unavailable/);
  assert.equal(requests, 1);
  assert.equal(retries, 0);
});
