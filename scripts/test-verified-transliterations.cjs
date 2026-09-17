const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lookupTransliterations, recordTransliteration, normalizeKey } = require('../lib/verifiedTransliterations');

test('normalizeKey trims and lowercases', () => {
  assert.equal(normalizeKey('  Бишкек  '), 'бишкек');
  assert.equal(normalizeKey(null), '');
});

test('lookup/record are fail-safe when Supabase is not configured (no env vars in this test run)', async () => {
  assert.deepEqual(await lookupTransliterations('client-a', ['Бишкек', 'Ош']), {});
  assert.deepEqual(await recordTransliteration('client-a', 'Бишкек', 'Bishkek'), { ok: false });
});

test('lookup merges global default with the client\'s own overrides, client wins on overlap', async () => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.p_original_keys, ['бишкек', 'ош']); // deduped + normalized
    if (String(url).includes('get_client_glossary_terms')) {
      assert.equal(body.p_client_slug, 'client-a');
      // Client has their own spelling for "Бишкек" only.
      return { ok: true, json: async () => ([{ original_key: 'бишкек', verified_value: 'Bishkek-City' }]) };
    }
    // Global default has both, but "бишкек" is overridden above.
    return { ok: true, json: async () => ([
      { original_key: 'бишкек', verified_value: 'Bishkek' },
      { original_key: 'ош', verified_value: 'Osh' }
    ]) };
  };
  try {
    const result = await lookupTransliterations('client-a', ['Бишкек', 'бишкек', 'Ош']);
    assert.deepEqual(result, { 'Бишкек': 'Bishkek-City', 'бишкек': 'Bishkek-City', 'Ош': 'Osh' });
  } finally {
    global.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('lookup falls back to the global default when the client has no override of their own', async () => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('get_client_glossary_terms')) return { ok: true, json: async () => ([]) };
    return { ok: true, json: async () => ([{ original_key: 'бишкек', verified_value: 'Bishkek' }]) };
  };
  try {
    const result = await lookupTransliterations('client-b', ['Бишкек']);
    assert.deepEqual(result, { 'Бишкек': 'Bishkek' });
  } finally {
    global.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('recordTransliteration sends the client slug, normalized key and original sample, and surfaces global-change info', async () => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const realFetch = global.fetch;
  let sentBody;
  global.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ([{ out_client_value: 'Bishkek', out_global_value: 'Bishkek', out_global_changed: true }]) };
  };
  try {
    const outcome = await recordTransliteration('client-a', '  Бишкек  ', 'Bishkek');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.globalChanged, true);
    assert.equal(outcome.globalValue, 'Bishkek');
    assert.equal(sentBody.p_client_slug, 'client-a');
    assert.equal(sentBody.p_original_key, 'бишкек');
    assert.equal(sentBody.p_original_sample, 'Бишкек');
    assert.equal(sentBody.p_verified_value, 'Bishkek');
  } finally {
    global.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('empty inputs never throw', async () => {
  assert.deepEqual(await lookupTransliterations('client-a', []), {});
  assert.deepEqual(await lookupTransliterations('client-a', undefined), {});
  assert.deepEqual(await recordTransliteration('client-a', '', 'x'), { ok: false, reason: 'empty' });
  assert.deepEqual(await recordTransliteration('client-a', 'x', ''), { ok: false, reason: 'empty' });
  assert.deepEqual(await recordTransliteration('', 'x', 'y'), { ok: false, reason: 'empty' });
});
