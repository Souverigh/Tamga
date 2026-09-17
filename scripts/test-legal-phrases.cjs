const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lookupLegalPhrases } = require('../lib/legalPhrases');

test('fail-safe when Supabase is not configured (no env vars in this test run)', async () => {
  assert.deepEqual(await lookupLegalPhrases('ky', ['Нотариально удостоверено']), { exact: {}, hints: [] });
});

test('empty/invalid input never throws', async () => {
  assert.deepEqual(await lookupLegalPhrases('ky', []), { exact: {}, hints: [] });
  assert.deepEqual(await lookupLegalPhrases('ky', undefined), { exact: {}, hints: [] });
});

test('exact match: segment text equals a known phrase (case/whitespace-insensitive)', async () => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.p_target_language, 'ky');
    assert.deepEqual(body.p_segment_texts, ['  Нотариально удостоверено  ']);
    return { ok: true, json: async () => ([
      { source_key: 'нотариально удостоверено', source_sample: 'Нотариально удостоверено', translated_value: 'Нотариалдык жактан күбөлөндүрүлгөн', needs_review: true, match_type: 'exact' }
    ]) };
  };
  try {
    const result = await lookupLegalPhrases('ky', ['  Нотариально удостоверено  ']);
    assert.deepEqual(result, {
      exact: { '  Нотариально удостоверено  ': { translatedValue: 'Нотариалдык жактан күбөлөндүрүлгөн', needsReview: true } },
      hints: []
    });
  } finally {
    global.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('partial match: phrase found inside a longer segment becomes a hint, not a substitution', async () => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ([
    { source_key: 'вступает в силу с момента подписания', source_sample: 'Вступает в силу с момента подписания', translated_value: 'Кол коюлган күндөн тартып күчүнө кирет', needs_review: true, match_type: 'partial' }
  ]) });
  try {
    const result = await lookupLegalPhrases('ky', ['Настоящий договор вступает в силу с момента подписания сторонами.']);
    assert.deepEqual(result.exact, {});
    assert.deepEqual(result.hints, [{ source: 'Вступает в силу с момента подписания', translated: 'Кол коюлган күндөн тартып күчүнө кирет', needsReview: true }]);
  } finally {
    global.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('a failed RPC call never throws — falls back to no glossary data', async () => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500 });
  try {
    assert.deepEqual(await lookupLegalPhrases('ky', ['Копия верна']), { exact: {}, hints: [] });
  } finally {
    global.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
