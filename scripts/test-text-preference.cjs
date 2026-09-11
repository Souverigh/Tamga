const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function settingsApi() {
  let row = { formatting: { webhookUrl: 'https://example.test/hook', businessRules: [{ type: 'required_field', field: 'X' }] } };
  let writes = 0;
  const staleFormatting = JSON.parse(JSON.stringify(row.formatting));
  const context = vm.createContext({
    module: { exports: {} }, console,
    process: { env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake' } },
    require: name => {
      if (name.includes('customFieldsLookup')) return { getClientConfig: async ({ fresh }) => ({ passwordHash: 'hash', formatting: fresh ? row.formatting : staleFormatting }), clearConfigCache() {} };
      if (name.includes('clientAuth')) return { requireClientSettingsAuth: () => ({ ok: true }) };
      return require('../' + name.replace(/^\.\.\//, ''));
    },
    fetch: async (_url, options) => {
      if (options.method === 'PATCH') { writes++; row = { ...row, ...JSON.parse(options.body) }; }
      return { ok: true, json: async () => [row] };
    }
  });
  vm.runInContext(fs.readFileSync('api/client-settings.js', 'utf8'), context);
  return {
    get row() { return row; }, get writes() { return writes; },
    async request(method, body) {
      const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
      await context.module.exports({ method, body, query: { slug: 'acme' }, headers: {} }, res);
      return res;
    }
  };
}

test('text preference round-trips without deleting other formatting settings', async () => {
  const api = settingsApi();
  assert.equal((await api.request('GET')).data.includeText, true);
  const saved = await api.request('PATCH', { include_text: false });
  assert.equal(saved.code, 200);
  assert.equal(saved.data.includeText, false);
  assert.equal(api.row.formatting.includeText, false);
  assert.equal(api.row.formatting.businessRules.length, 1);
  assert.equal(api.row.formatting.webhookUrl, 'https://example.test/hook');
  const reopened = await api.request('GET');
  assert.equal(reopened.data.includeText, false, 'reopening settings must bypass stale process caches');
  assert.match(reopened.headers['Cache-Control'], /no-store/);
  assert.equal((await api.request('PATCH', { include_text: true })).data.includeText, true);
});

test('text preference rejects non-boolean values without writing', async () => {
  const api = settingsApi();
  const response = await api.request('PATCH', { include_text: 'false' });
  assert.equal(response.code, 400);
  assert.equal(api.writes, 0);
});
