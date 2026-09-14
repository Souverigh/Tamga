const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lookupTransliterations, recordTransliteration, normalizeKey } = require('../lib/verifiedTransliterations');

test('normalizeKey trims and lowercases', () => {
  assert.equal(normalizeKey('  Бишкек  '), 'бишкек');
  assert.equal(normalizeKey(null), '');
});

test('lookup/record are fail-safe when Supabase is not configured (no env vars in this test run)', async () => {
  assert.deepEqual(await lookupTransliterations(['Бишкек', 'Ош']), {});
  assert.deepEqual(await recordTransliteration('Бишкек', 'Bishkek'), { ok: false });
});

test('lookup returns only originals that were actually found, mapped back to the caller\'s original casing', async () => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.p_original_keys, ['бишкек', 'ош']); // deduped + normalized
    return { ok: true, json: async () => ([{ original_key: 'бишкек', verified_value: 'Bishkek' }]) };
  };
  try {
    const result = await lookupTransliterations(['Бишкек', 'бишкек', 'Ош']);
    assert.deepEqual(result, { 'Бишкек': 'Bishkek', 'бишкек': 'Bishkek' });
    assert.equal('Ош' in result, false);
  } finally {
    global.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('recordTransliteration sends the normalized key alongside the original sample', async () => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const realFetch = global.fetch;
  let sentBody;
  global.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ([{ out_verified_value: 'Bishkek', out_confirmed_count: 1 }]) };
  };
  try {
    const outcome = await recordTransliteration('  Бишкек  ', 'Bishkek');
    assert.equal(outcome.ok, true);
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
  assert.deepEqual(await lookupTransliterations([]), {});
  assert.deepEqual(await lookupTransliterations(undefined), {});
  assert.deepEqual(await recordTransliteration('', 'x'), { ok: false, reason: 'empty' });
  assert.deepEqual(await recordTransliteration('x', ''), { ok: false, reason: 'empty' });
});
