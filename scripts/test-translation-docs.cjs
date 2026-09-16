#!/usr/bin/env node
// Регрессионный тест: lib/translationDocs/pipeline.js:recognizeAndTranslateDocument
// — новый модуль "Перевод" (Ethan, 16 сен 2026: "то же самое для перевода —
// отдельная загрузка, как бухгалтерия; общий лимит страниц с распознаванием;
// плюс апостиль и другие типы документов"). Проверяет:
//   1) без clientApiKey/clientSlug — квота не проверяется (используется
//      только внутренними вызовами, не публичными эндпоинтами);
//   2) clientApiKey/clientSlug — страница списывается ДО Gemini (тот же
//      приём, что lib/accounting/pipeline.js), уважает allowed/unavailable
//      (402/503, Gemini не вызывается при отказе);
//   3) неверный тип документа (doc_type не в TYPE_REGISTRY) — 422,
//      translateSegments не вызывается;
//   4) успешный путь — поля апостиля переведены (translateSegments
//      вызывается только для непустых значений), аналитика пишется под
//      конкретным doc_type (не общим "Перевод");
//   5) документ без единого заполненного поля — translateSegments вообще не
//      вызывается (нечего переводить), ответ всё равно валиден.
//
// Полностью мокает callGemini/consumeUsage/recordUsageEvent/
// validateTranslationRequest/translateSegments через require.cache —
// реальных вызовов к Gemini/Supabase нет. Тот же приём, что
// scripts/test-accounting-quota.cjs.

const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failures = 0;
const results = [];
async function scenario(label, fn) {
  try {
    await fn();
    results.push({ label, ok: true });
  } catch (err) {
    failures += 1;
    results.push({ label, ok: false, error: err.message });
  }
}

// --- Моки ---------------------------------------------------------------

let callGeminiImpl = async () => { throw new Error('callGeminiImpl не задан сценарием'); };
const geminiClientPath = path.join(ROOT, 'lib/geminiClient.js');
require.cache[require.resolve(geminiClientPath)] = {
  id: geminiClientPath, filename: geminiClientPath, loaded: true,
  exports: {
    callGemini: (...args) => callGeminiImpl(...args),
    GeminiError: class GeminiError extends Error {}
  }
};

let consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 1, pageLimit: 1000 });
let consumeUsageCalls = [];
const cflPath = path.join(ROOT, 'lib/customFieldsLookup.js');
require.cache[require.resolve(cflPath)] = {
  id: cflPath, filename: cflPath, loaded: true,
  exports: {
    consumeUsage: (...args) => { consumeUsageCalls.push(args[0]); return consumeUsageImpl(...args); }
  }
};

let recordUsageEventCalls = [];
const uaPath = path.join(ROOT, 'lib/usageAnalytics.js');
require.cache[require.resolve(uaPath)] = {
  id: uaPath, filename: uaPath, loaded: true,
  exports: {
    recordUsageEvent: async (...args) => { recordUsageEventCalls.push(args[0]); return { ok: true }; }
  }
};

let translateSegmentsCalls = [];
const translationPath = path.join(ROOT, 'lib/translation.js');
require.cache[require.resolve(translationPath)] = {
  id: translationPath, filename: translationPath, loaded: true,
  exports: {
    validateTranslationRequest: body => body, // проходит как есть — сама валидация не тестируется здесь
    translateSegments: async (request, clientRef) => {
      translateSegmentsCalls.push({ request, clientRef });
      return { segments: request.segments.map(s => ({ id: s.id, text: `[TR]${s.text}` })) };
    }
  }
};

delete require.cache[require.resolve(path.join(ROOT, 'lib/translationDocs/pipeline.js'))];
const { recognizeAndTranslateDocument, TranslationDocError } = require(path.join(ROOT, 'lib/translationDocs/pipeline.js'));

const FAKE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrWQAAAAASUVORK5CYII=';

function fakeApostilleResponse(overrides = {}) {
  return {
    result: {
      doc_type: 'apostille',
      country: { value: 'Кыргызская Республика', raw_text: 'Кыргызская Республика', page: 1, confidence: 95 },
      apostille_number: { value: '482', raw_text: '№ 482', page: 1, confidence: 92 },
      signatory_name: { value: '', raw_text: '', page: 1, confidence: 0 },
      signatory_capacity: { value: '', raw_text: '', page: 1, confidence: 0 },
      seal_authority: { value: '', raw_text: '', page: 1, confidence: 0 },
      certified_place: { value: 'г. Бишкек', raw_text: 'г. Бишкек', page: 1, confidence: 88 },
      certified_date: { value: '2026-09-10', raw_text: '10.09.2026', page: 1, confidence: 90 },
      certifying_official: { value: '', raw_text: '', page: 1, confidence: 0 },
      registry_number: { value: '', raw_text: '', page: 1, confidence: 0 },
      additional_notes: { value: '', raw_text: '', page: 1, confidence: 0 },
      ...overrides
    },
    usage: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 }
  };
}

function fakeEmptyApostilleResponse() {
  const r = fakeApostilleResponse();
  for (const key of Object.keys(r.result)) {
    if (key === 'doc_type') continue;
    r.result[key] = { value: '', raw_text: '', page: 1, confidence: 0 };
  }
  return r;
}

async function main() {
  await scenario('Без clientApiKey/clientSlug — квота вообще не проверяется, документ переводится', async () => {
    consumeUsageCalls = []; recordUsageEventCalls = []; translateSegmentsCalls = [];
    let geminiCalled = false;
    callGeminiImpl = async () => { geminiCalled = true; return fakeApostilleResponse(); };
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en' });
    assert.strictEqual(result.docType, 'apostille');
    assert.strictEqual(geminiCalled, true);
    assert.strictEqual(consumeUsageCalls.length, 0, 'consumeUsage не должен вызываться без clientApiKey/clientSlug');
    assert.strictEqual(recordUsageEventCalls.length, 0, 'аналитика не должна писаться без clientApiKey/clientSlug');
    assert.strictEqual(translateSegmentsCalls.length, 1, 'перевод всё равно должен произойти');
  });

  await scenario('clientApiKey, allowed=true — страница списывается ДО Gemini, аналитика под doc_type="apostille"', async () => {
    consumeUsageCalls = []; recordUsageEventCalls = []; translateSegmentsCalls = [];
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 5, pageLimit: 1000 });
    callGeminiImpl = async () => fakeApostilleResponse();
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en', clientApiKey: 'ext-key-123' });
    assert.strictEqual(result.docType, 'apostille');
    assert.strictEqual(consumeUsageCalls.length, 1);
    assert.strictEqual(consumeUsageCalls[0].apiKey, 'ext-key-123');
    assert.strictEqual(recordUsageEventCalls.length, 1);
    assert.strictEqual(recordUsageEventCalls[0].clientRef, 'ext-key-123');
    assert.strictEqual(recordUsageEventCalls[0].docType, 'apostille');
    assert.strictEqual(translateSegmentsCalls[0].clientRef, 'ext-key-123');
  });

  await scenario('clientSlug (веб-панель) — тот же путь, что clientApiKey, под slug', async () => {
    consumeUsageCalls = []; recordUsageEventCalls = []; translateSegmentsCalls = [];
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 2, pageLimit: 50 });
    callGeminiImpl = async () => fakeApostilleResponse();
    await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'ru', clientSlug: 'acme' });
    assert.strictEqual(consumeUsageCalls[0].clientSlug, 'acme');
    assert.strictEqual(recordUsageEventCalls[0].clientRef, 'acme');
  });

  await scenario('Лимит исчерпан (allowed=false) → 402 QUOTA_EXCEEDED, Gemini НЕ вызывается', async () => {
    consumeUsageImpl = async () => ({ allowed: false, pagesUsed: 100, pageLimit: 100 });
    let geminiCalled = false;
    callGeminiImpl = async () => { geminiCalled = true; return fakeApostilleResponse(); };
    await assert.rejects(
      recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en', clientApiKey: 'ext-key-123' }),
      err => {
        assert.ok(err instanceof TranslationDocError);
        assert.strictEqual(err.status, 402);
        assert.strictEqual(err.code, 'QUOTA_EXCEEDED');
        return true;
      }
    );
    assert.strictEqual(geminiCalled, false, 'исчерпанный лимит не должен тратить вызов Gemini');
  });

  await scenario('Учёт лимитов недоступен (unavailable=true) → 503 QUOTA_UNAVAILABLE, Gemini НЕ вызывается (fail-closed)', async () => {
    consumeUsageImpl = async () => ({ unavailable: true, allowed: false, pagesUsed: 0, pageLimit: null });
    let geminiCalled = false;
    callGeminiImpl = async () => { geminiCalled = true; return fakeApostilleResponse(); };
    await assert.rejects(
      recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en', clientSlug: 'acme' }),
      err => {
        assert.ok(err instanceof TranslationDocError);
        assert.strictEqual(err.status, 503);
        assert.strictEqual(err.code, 'QUOTA_UNAVAILABLE');
        return true;
      }
    );
    assert.strictEqual(geminiCalled, false);
  });

  await scenario('Неизвестный тип документа (doc_type="unknown") → 422 wrong_doc_type, перевод не запускается', async () => {
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 1, pageLimit: 1000 });
    translateSegmentsCalls = [];
    callGeminiImpl = async () => ({ result: { doc_type: 'unknown' }, usage: null });
    await assert.rejects(
      recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en', clientSlug: 'acme' }),
      err => {
        assert.ok(err instanceof TranslationDocError);
        assert.strictEqual(err.status, 422);
        assert.strictEqual(err.code, 'wrong_doc_type');
        return true;
      }
    );
    assert.strictEqual(translateSegmentsCalls.length, 0);
  });

  await scenario('Успешный путь — только непустые поля переводятся, translated проставляется по id', async () => {
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 1, pageLimit: 1000 });
    translateSegmentsCalls = [];
    callGeminiImpl = async () => fakeApostilleResponse();
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en', clientSlug: 'acme' });
    assert.strictEqual(translateSegmentsCalls[0].request.segments.length, 2, 'только переводимые поля (country/certified_place)');
    const byKey = Object.fromEntries(result.fields.map(f => [f.key, f]));
    assert.strictEqual(byKey.country.translated, '[TR]Кыргызская Республика');
    assert.strictEqual(byKey.apostille_number.translated, '482');
    assert.strictEqual(byKey.apostille_number.translationStatus, 'preserved');
    assert.strictEqual(byKey.certified_date.translated, '2026-09-10');
    assert.strictEqual(byKey.signatory_name.value, '');
    assert.strictEqual(byKey.signatory_name.translated, '', 'пустые поля не переводятся');
  });

  await scenario('Документ без единого заполненного поля — translateSegments не вызывается', async () => {
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 1, pageLimit: 1000 });
    translateSegmentsCalls = [];
    callGeminiImpl = async () => fakeEmptyApostilleResponse();
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en', clientSlug: 'acme' });
    assert.strictEqual(translateSegmentsCalls.length, 0, 'нечего переводить — Gemini не дёргается зря');
    assert.ok(result.fields.every(f => f.value === '' && f.translated === ''));
  });

  console.log('\n=== Регрессия модуля "Перевод" (recognizeAndTranslateDocument) ===');
  results.forEach(r => {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}`);
    if (!r.ok) console.log(`    ${r.error}`);
  });
  console.log(`\n${failures === 0 ? '✅ Квота, классификация и перевод работают как ожидается' : `❌ Провалов: ${failures}`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Скрипт упал:', err);
  process.exit(1);
});
