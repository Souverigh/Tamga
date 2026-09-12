const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const { readRequestBody } = require('../lib/multipart');

test('multipart request exposes the uploaded file and form fields', async () => {
  const boundary = 'tamga-test-boundary';
  const request = new PassThrough();
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="includeText"',
    '',
    'false',
    `--${boundary}`,
    'Content-Disposition: form-data; name="image"; filename="page.jpg"',
    'Content-Type: image/jpeg',
    '',
    'image-bytes',
    `--${boundary}--`,
    ''
  ].join('\r\n');
  const parsed = readRequestBody(request);
  request.end(body);
  const result = await parsed;
  assert.equal(result.includeText, false);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(Buffer.from(result.image, 'base64').toString(), 'image-bytes');
});

test('explicit full-text choice is sent for both enabled and disabled states', async () => {
  const bodies = [];
  const context = vm.createContext({
    pageImageToBase64: () => 'image',
    fetch: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ text: '', fields: [], items: [] }) };
    }
  });
  const source = fs.readFileSync('public/js/api/geminiRecognizeClient.js', 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInContext(source, context);
  await context.recognizeWithGemini('image', null, { includeText: true });
  await context.recognizeWithGemini('image', null, { includeText: false });
  assert.equal(bodies[0].includeText, true);
  assert.equal(bodies[1].includeText, false);
});

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
