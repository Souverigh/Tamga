const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function facade(search, config = {}, token = 'token') {
  const elements = new Map();
  const cleared = [];
  let redirected;
  const storage = new Map([['tamga_client_slug', 'admin']]);
  const context = vm.createContext({
    URLSearchParams, window: { location: { search, replace: url => { redirected = url; } } },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    createIdleSession: key => ({ get: () => token, clear: () => { cleared.push(key); } }), setExtraDocTypes() {},
    document: {
      getElementById: id => {
        if (!elements.has(id)) elements.set(id, { style: { display: 'none' }, textContent: '' });
        return elements.get(id);
      },
      documentElement: { style: {}, classList: { remove() {} } },
    },
    fetch: async () => ({ ok: true, json: async () => config }), console,
  });
  vm.runInContext(fs.readFileSync('public/js/branding.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), context);
  return { context, elements, cleared, get redirected() { return redirected; } };
}

test('logout clears only the current client session and returns to its login', async () => {
  const b = facade('?client=acme', { isClient: true });
  await b.context.initBranding();
  assert.equal(b.elements.get('logoutBtn').style.display, 'inline-flex');
  b.elements.get('logoutBtn').onclick();
  assert.deepEqual(b.cleared, ['tamga_client_token:acme']);
  assert.equal(b.redirected, '/?client=acme');
  assert.equal(b.context.document.documentElement.style.visibility, 'hidden');
});

test('logout is hidden without a client or without a session', async () => {
  for (const search of ['', '?client=acme']) {
    const b = facade(search, { isClient: true }, null);
    await b.context.initBranding();
    assert.equal(b.elements.get('logoutBtn').style.display, 'none');
  }
});

test('root page ignores previously saved admin slug', async () => {
  const b = facade('');
  assert.equal(b.context.getClientSlug(), null);
  await b.context.initBranding();
  assert.equal(b.elements.get('settingsLink').style.display, 'none');
  assert.equal(b.elements.get('freeLimitNote').style.display, 'block');
});

test('configured client sees settings and remaining pages, refreshed from server', async () => {
  const config = { isClient: true, pageLimit: 100, pagesUsed: 27 };
  const b = facade('?client=acme', config);
  await b.context.initBranding();
  assert.equal(b.elements.get('settingsLink').href, '/settings/?client=acme');
  assert.equal(b.elements.get('settingsLink').style.display, 'inline-flex');
  assert.match(b.elements.get('planUsageNote').textContent, /73.*100/);
  config.pagesUsed = 100;
  await b.context.refreshClientUsage();
  assert.match(b.elements.get('planUsageNote').textContent, /0.*100/);
});

test('unknown slug does not get client settings or hide the free limit', async () => {
  const b = facade('?client=unknown'); await b.context.initBranding();
  assert.equal(b.elements.get('settingsLink').style.display, 'none');
  assert.equal(b.elements.get('freeLimitNote').style.display, 'block');
});

test('admin link is available for explicit admin URL', async () => {
  const b = facade('?client=admin'); await b.context.initBranding();
  assert.equal(b.elements.get('settingsLink').style.display, 'inline-flex');
});

test('unlimited clients do not show a misleading numeric balance', async () => {
  const b = facade('?client=acme', { isClient: true, pageLimit: null, pagesUsed: 27 });
  await b.context.initBranding();
  assert.match(b.elements.get('planUsageNote').textContent, /безлимит/i);
});

test('free quota permits three pages and rejects the fourth', async () => {
  let pages = 0;
  const context = vm.createContext({
    module: { exports: {} }, require, console,
    process: { env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', TAMGA_FREE_DAILY_PAGE_LIMIT: '20' } },
    fetch: async (_url, options) => {
      const { p_daily_limit: limit } = JSON.parse(options.body);
      const allowed = pages < limit;
      if (allowed) pages++;
      return { ok: true, json: async () => [{ allowed, pages_used: pages }] };
    },
  });
  vm.runInContext(fs.readFileSync('lib/anonymousUsage.js', 'utf8'), context);
  const consume = context.module.exports.consumeAnonymousUsage;
  for (let i = 0; i < 3; i++) assert.equal((await consume('test-ip')).allowed, true);
  assert.equal((await consume('test-ip')).allowed, false);
});

test('free recognition cannot bypass quota when accounting is unavailable', async () => {
  for (const env of [{}, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' }]) {
    const context = vm.createContext({ module: { exports: {} }, require, console: { error() {} },
      process: { env }, fetch: async () => ({ ok: false, status: 503 }) });
    vm.runInContext(fs.readFileSync('lib/anonymousUsage.js', 'utf8'), context);
    await assert.rejects(context.module.exports.consumeAnonymousUsage('test-ip'));
  }
});

test('unknown client uses the free quota path at the recognition endpoint', async () => {
  let input;
  const context = vm.createContext({ module: { exports: {} }, console,
    require: name => {
      if (name.includes('customFieldsLookup')) return { getClientConfig: async () => null };
      if (name.includes('clientAuth')) return { checkClientGate: () => ({ ok: true }) };
      if (name.includes('anonymousUsage')) return { extractClientIp: () => 'test-ip' };
      if (name === '../lib/recognize') return {
        RecognizeError: class extends Error {}, recognizeDocument: async args => { input = args; return {}; },
      };
      throw new Error(name);
    },
  });
  vm.runInContext(fs.readFileSync('api/recognize.js', 'utf8'), context);
  const res = { status() { return this; }, json() {} };
  await context.module.exports({ method: 'POST', headers: {}, body: { clientSlug: 'invented', image: 'image', mimeType: 'image/jpeg' } }, res);
  assert.equal(input.clientSlug, null);
  assert.equal(input.clientIp, 'test-ip');
});

test('fresh config reads include the current package balance', async () => {
  let used = 27;
  const context = vm.createContext({ module: { exports: {} }, console,
    process: { env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' } },
    require: () => ({ validateBusinessRules: () => ({ value: [] }) }),
    fetch: async () => ({ ok: true, json: async () => [{ page_limit: 100, pages_used: used }] }),
  });
  vm.runInContext(fs.readFileSync('lib/customFieldsLookup.js', 'utf8'), context);
  const get = context.module.exports.getClientConfig;
  assert.equal((await get({ clientSlug: 'acme' })).pagesUsed, 27);
  used = 30;
  const updated = await get({ clientSlug: 'acme', fresh: true });
  assert.equal(updated.pagesUsed, 30);
  assert.equal(updated.pageLimit, 100);
});
