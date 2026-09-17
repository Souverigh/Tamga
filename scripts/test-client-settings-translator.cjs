// Регрессия: /api/client-settings — translator_name (Ethan, 17 сен 2026,
// "под нотариальное заверение": ФИО переводчика хранится в client-settings
// formatting.translatorName, read-modify-write рядом с includeText/
// businessRules, см. api/client-settings.js). Тот же приём мока через
// vm.createContext, что и в scripts/test-text-preference.cjs (тот файл не
// подключён к npm test и на момент написания этого теста был сломан сам по
// себе — этот файл написан заново, а не поверх него).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function settingsApi(initialFormatting = {}) {
  let row = { formatting: initialFormatting };
  let writes = 0;
  const context = vm.createContext({
    module: { exports: {} }, console,
    process: { env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake' } },
    require: name => {
      if (name.includes('customFieldsLookup')) return { getClientConfig: async () => ({ passwordHash: 'hash', formatting: row.formatting }), clearConfigCache() {} };
      if (name.includes('clientAuth')) return { requireClientSettingsAuth: async () => ({ ok: true, role: 'owner', username: '', translatorName: null }) };
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

test('translatorName is absent by default, round-trips on save without touching other formatting keys', async () => {
  const api = settingsApi({ webhookUrl: 'https://example.test/hook', businessRules: [{ type: 'required_field', field: 'X' }] });
  assert.equal((await api.request('GET')).data.translatorName, null);
  const saved = await api.request('PATCH', { translator_name: '  Иванова Айгуль Бакытовна  ' });
  assert.equal(saved.code, 200);
  assert.equal(saved.data.translatorName, 'Иванова Айгуль Бакытовна', 'должно быть обрезано по краям');
  assert.equal(api.row.formatting.webhookUrl, 'https://example.test/hook');
  assert.equal(api.row.formatting.businessRules.length, 1);
  const reopened = await api.request('GET');
  assert.equal(reopened.data.translatorName, 'Иванова Айгуль Бакытовна');
});

test('translatorName clears with an empty string, dropping the key entirely rather than storing ""', async () => {
  const api = settingsApi({ translatorName: 'Старое Имя' });
  const saved = await api.request('PATCH', { translator_name: '' });
  assert.equal(saved.code, 200);
  assert.equal(saved.data.translatorName, null);
  assert.equal(api.row.formatting, null, 'formatting had only translatorName, so clearing it collapses formatting to null');
});

test('translatorName rejects non-string / too-long values without writing', async () => {
  const api = settingsApi();
  const nonString = await api.request('PATCH', { translator_name: 123 });
  assert.equal(nonString.code, 400);
  const tooLong = await api.request('PATCH', { translator_name: 'a'.repeat(201) });
  assert.equal(tooLong.code, 400);
  assert.equal(api.writes, 0);
});
