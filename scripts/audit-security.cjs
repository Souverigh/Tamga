// Security regression gates. Synthetic data only; no external requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function cjs(file, globals = {}) {
  const context = vm.createContext({ module: { exports: {} }, require,
    console: { log() {}, error() {} }, ...globals });
  vm.runInContext(read(file), context);
  return context.module.exports;
}

test('A01 protection: PDF evaluation disabled', () => {
  
  assert.match(read('public/js/ocr/pdfLoader.js'), /isEvalSupported: false/);
});

test('A02 protection: documents do not persist across client contexts', () => {
  const values = new Map();
  const localStorage = { setItem: (k,v) => values.set(k,v), getItem: k => values.get(k), removeItem: k => values.delete(k) };
  const source = read('public/js/storage/resultsStorage.js').replace(/export /g, '');
  const clientA = vm.createContext({ localStorage });
  vm.runInContext(source, clientA);
  clientA.saveResultsToStorage([{ fileName: 'synthetic-client-A', fields: [{ value: 'synthetic-private-value' }] }]);
  const clientB = vm.createContext({ localStorage });
  vm.runInContext(source, clientB);
  assert.equal(clientB.loadSavedResults(), null);
  assert.equal(values.size, 0);
});

test('A03 protection: analytics failures never log credentials', async () => {
  const messages = [];
  const source = read('lib/recognize.js');
  const start = source.indexOf('async function safeRecordUsageEvent(');
  const end = source.indexOf('\nfunction combineUsage', start);
  const context = vm.createContext({ recordUsageEvent: async () => ({ ok: false, reason: 'synthetic-failure' }),
    console: { error: (...args) => messages.push(args.join(' ')) } });
  vm.runInContext(source.slice(start, end), context);
  await context.safeRecordUsageEvent({ clientRef: 'FAKE_AUDIT_API_KEY', success: true });
  assert.ok(!messages.some(message => message.includes('FAKE_AUDIT_API_KEY')));
});

test('A04 protection: password replacement invalidates existing tokens', () => {
  const auth = cjs('lib/clientAuth.js', { Buffer, process: { env: { TAMGA_CLIENT_AUTH_SECRET: 'fake-audit-only-secret' } } });
  const token = auth.signToken('synthetic-client', auth.hashPassword('old-password'));
  const changedPasswordHash = auth.hashPassword('new-synthetic-password');
  assert.equal(auth.requireClientSettingsAuth({ clientSlug: 'synthetic-client', passwordHash: changedPasswordHash, token }).ok, false);
  assert.equal(auth.verifyToken(token, 'another-client'), false);
});

test('A05 protection: invalid base64 and MIME mismatches are rejected', () => {
  const source = read('lib/recognize.js');
  const context = vm.createContext({ Buffer });
  vm.runInContext(source.slice(source.indexOf('const ALLOWED_MIME_TYPES'), source.indexOf('function buildInstructionAndSchema')), context);
  assert.throws(() => context.validateInput({ base64: '!!!!', mimeType: 'image/png' }));
  assert.throws(() => context.validateInput({ base64: Buffer.from('not an image').toString('base64'), mimeType: 'image/png' }));
});

test('A07 protection: quota and authentication fail closed on database errors', async () => {
  const globals = { process: { env: { SUPABASE_URL: 'https://not-used.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fake' } },
    fetch: async () => ({ ok: false, status: 503 }),
    require: name => name === './clientConfigValidation' ? {} : name === './anonymousUsage' ? { hashIp: () => 'synthetic-hash' } : require(name) };
  const usage = cjs('lib/customFieldsLookup.js', globals);
  assert.equal((await usage.consumeUsage({ clientSlug: 'synthetic-client' })).allowed, false);
  const limiter = cjs('lib/authRateLimit.js', globals);
  assert.equal((await limiter.checkClientAuthRateLimit({ clientSlug: 'synthetic-client', ip: '192.0.2.1' })).allowed, false);
});

test('A09 protection: CSV formula prefixes are neutralized', () => {
  const context = vm.createContext({});
  vm.runInContext(read('public/js/export/csvExport.js').replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), context);
  for (const value of ['=1+1', '+cmd', '-cmd', '@SUM(A1)', '  =1', '\t=1']) {
    assert.ok(context.csvEscape(value).startsWith("'"));
  }
});


test('A08 rejects internal addresses and credential URLs before delivery', async () => {
  const { validateWebhookUrl, isPublicIPv4 } = require('../lib/safeWebhook');
  for (const host of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '[::1]', '2130706433']) {
    assert.throws(() => validateWebhookUrl('https://' + host));
  }
  assert.throws(() => validateWebhookUrl('https://user:pass@example.com'));
  assert.throws(() => validateWebhookUrl('http://example.com'));
  assert.equal(isPublicIPv4('8.8.8.8'), true);
  assert.equal(isPublicIPv4('100.64.0.1'), false);
});

test('A06 rejects oversized files and bounds PDF canvas dimensions', () => {
  const context = vm.createContext({});
  vm.runInContext(read('public/js/utils/fileSafety.js').replace(/export /g, ''), context);
  assert.throws(() => context.validateFileSize({ size: 21 * 1024 * 1024 }));
  assert.throws(() => context.boundedViewport({ width: Infinity, height: 1 }));
  const view = context.boundedViewport({ width: 100000, height: 100000 });
  assert.ok(view.scale < 1);
  assert.ok(100000 * 100000 * view.scale ** 2 <= 8000001);
});

test('A07 Gemini budget fails closed and distinguishes exhaustion', async () => {
  const { reserveGeminiBudget } = cjs('lib/geminiBudget.js', {
    process: { env: {} }, fetch: async () => { throw new Error('must not fetch'); }
  });
  await assert.rejects(reserveGeminiBudget({ mimeType: 'image/jpeg', instruction: '' }), /unavailable/);
});

test('A04 current password token works and extra token components fail', () => {
  const auth = cjs('lib/clientAuth.js', { Buffer, process: { env: { TAMGA_CLIENT_AUTH_SECRET: 'test-secret' } } });
  const hash = auth.hashPassword('synthetic-password');
  const token = auth.signToken('client', hash);
  assert.equal(auth.verifyToken(token, 'client', hash), true);
  assert.equal(auth.verifyToken(token + '.extra', 'client', hash), false);
});

test('A08 DNS answers are checked and the approved address is pinned; redirects are not followed', async () => {
  let requests = 0;
  const { postWebhook } = cjs('lib/safeWebhook.js', { URL,
    require: name => name === 'node:dns' ? { promises: { lookup: async () => [{ address: '8.8.8.8', family: 4 }] } }
      : name === 'node:https' ? { request: (url, options, callback) => {
        requests++;
        options.lookup('example.com', {}, (error, address) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); });
        return { on() {}, end() { callback({ statusCode: 302, destroy() {} }); } };
      } } : require(name)
  });
  const result = await postWebhook('https://example.com', '{}', {}, new AbortController().signal);
  assert.equal(result.ok, false);
  assert.equal(requests, 1);
});

test('A06 image dimensions are validated before decoding; normal PNG succeeds', async () => {
  const context = vm.createContext({ Uint8Array, DataView, setTimeout, clearTimeout });
  vm.runInContext(read('public/js/utils/fileSafety.js').replace(/export /g, ''), context);
  const b = new Uint8Array(33); b.set([137,80,78,71,13,10,26,10]);
  const d = new DataView(b.buffer); d.setUint32(16, 1); d.setUint32(20, 1);
  const file = { size: 33, arrayBuffer: async () => b.buffer };
  assert.equal((await context.validateImageFile(file)).width, 1);
  d.setUint32(16, 100000); d.setUint32(20, 100000);
  await assert.rejects(context.validateImageFile(file), /40/);
  let cancelled = false;
  await assert.rejects(context.withDeadline(new Promise(() => {}), () => { cancelled = true; }, 5));
  assert.equal(cancelled, true);
});

test('A06 HEIC decoder is serialized and its context is removed on timeout', async () => {
  const frames = [], timers = new Map(); let sequence = 0, receive;
  const context = vm.createContext({
    setTimeout: callback => { timers.set(++sequence, callback); return sequence; },
    clearTimeout: id => timers.delete(id),
    window: { addEventListener: (_name, callback) => { receive = callback; }, removeEventListener() {} },
    document: { createElement: () => ({ setAttribute() {}, contentWindow: {}, remove() { this.removed = true; } }), body: { appendChild: frame => frames.push(frame) } }
  });
  vm.runInContext(read('public/js/utils/heicSupport.js').replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), context);
  const first = context.decodeInFrame({}), second = context.decodeInFrame({});
  const rejected = assert.rejects(second, /HEIC/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(frames.length, 1);
  receive({ source: frames[0].contentWindow, data: { type: 'decoded', blob: 'synthetic' } });
  assert.equal(await first, 'synthetic');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(frames[0].removed, true);
  assert.equal(frames.length, 2);
  [...timers.values()][0]();
  await rejected;
  assert.equal(frames[1].removed, true);
});

test('A06 lists use bounded thumbnails rather than decoding every original image', () => {
  const source = read('public/js/ui/fileList.js');
  assert.doesNotMatch(source, /img.src = (previewUrls|urlByFile)/);
});
