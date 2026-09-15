#!/usr/bin/env node
// Регрессионный тест: lib/accounting/pipeline.js:recognizeAccountingDocument
// теперь опционально списывает страницу из ОБЩЕГО пакета клиента
// (page_limit/pages_used, та же RPC consume_page_usage, что у
// lib/recognize.js) — добавлено 15 сен 2026, когда Ethan попросил открыть
// модуль бухгалтерии платным клиентам ("общий лимит с обычным
// распознаванием"). Проверяет ровно эту гарантию:
//   1) старые вызовы без clientApiKey/clientSlug (api/accounting/recognize.js
//      с ACCOUNTING_API_KEYS, api/accounting/admin-recognize.js) — поведение
//      НЕ меняется, квота вообще не проверяется;
//   2) новые вызовы (api/v1/accounting/recognize.js, api/accounting/
//      client-recognize.js) списывают страницу ДО обращения к Gemini и
//      уважают allowed/unavailable из consumeUsage так же, как
//      lib/recognize.js (402/503, Gemini не вызывается при отказе).
//
// Полностью мокает callGemini/consumeUsage/recordUsageEvent через
// require.cache — реальных вызовов к Gemini/Supabase нет, GEMINI_API_KEY не
// нужен, сеть не используется. Тот же приём, что scripts/test-pipeline.js.

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

const { recognizeAccountingDocument, AccountingError } = require(path.join(ROOT, 'lib/accounting/pipeline.js'));

const FAKE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrWQAAAAASUVORK5CYII=';

function fakeEsfResponse() {
  return {
    result: {
      doc_type: 'esf',
      invoice_number: { value: 'INV-1', confidence: 90 },
      items: []
    },
    usage: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }
  };
}

async function main() {
  await scenario('Без clientApiKey/clientSlug (старые вызывающие) — квота вообще не проверяется', async () => {
    consumeUsageCalls = [];
    recordUsageEventCalls = [];
    let geminiCalled = false;
    callGeminiImpl = async () => { geminiCalled = true; return fakeEsfResponse(); };
    const result = await recognizeAccountingDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake' });
    assert.strictEqual(result.docType, 'esf');
    assert.strictEqual(geminiCalled, true);
    assert.strictEqual(consumeUsageCalls.length, 0, 'consumeUsage не должен вызываться без clientApiKey/clientSlug');
    assert.strictEqual(recordUsageEventCalls.length, 0, 'аналитика не должна писаться без clientApiKey/clientSlug');
  });

  await scenario('clientApiKey, allowed=true — страница списывается ДО Gemini, аналитика пишется под тем же client_ref', async () => {
    consumeUsageCalls = [];
    recordUsageEventCalls = [];
    let geminiCalled = false;
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 5, pageLimit: 1000 });
    callGeminiImpl = async () => { geminiCalled = true; return fakeEsfResponse(); };
    const result = await recognizeAccountingDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', clientApiKey: 'ext-key-123' });
    assert.strictEqual(result.docType, 'esf');
    assert.strictEqual(geminiCalled, true);
    assert.strictEqual(consumeUsageCalls.length, 1);
    assert.strictEqual(consumeUsageCalls[0].apiKey, 'ext-key-123');
    assert.strictEqual(recordUsageEventCalls.length, 1);
    assert.strictEqual(recordUsageEventCalls[0].clientRef, 'ext-key-123');
    assert.strictEqual(recordUsageEventCalls[0].docType, 'esf');
  });

  await scenario('clientSlug (веб-панель), allowed=true — тот же путь, что clientApiKey, под clientSlug', async () => {
    consumeUsageCalls = [];
    recordUsageEventCalls = [];
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 2, pageLimit: 50 });
    callGeminiImpl = async () => fakeEsfResponse();
    const result = await recognizeAccountingDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', clientSlug: 'acme' });
    assert.strictEqual(result.docType, 'esf');
    assert.strictEqual(consumeUsageCalls[0].clientSlug, 'acme');
    assert.strictEqual(recordUsageEventCalls[0].clientRef, 'acme');
  });

  await scenario('Лимит исчерпан (allowed=false) → 402 QUOTA_EXCEEDED, Gemini НЕ вызывается', async () => {
    consumeUsageImpl = async () => ({ allowed: false, pagesUsed: 100, pageLimit: 100 });
    let geminiCalled = false;
    callGeminiImpl = async () => { geminiCalled = true; return fakeEsfResponse(); };
    await assert.rejects(
      recognizeAccountingDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', clientApiKey: 'ext-key-123' }),
      err => {
        assert.ok(err instanceof AccountingError);
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
    callGeminiImpl = async () => { geminiCalled = true; return fakeEsfResponse(); };
    await assert.rejects(
      recognizeAccountingDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', clientSlug: 'acme' }),
      err => {
        assert.ok(err instanceof AccountingError);
        assert.strictEqual(err.status, 503);
        assert.strictEqual(err.code, 'QUOTA_UNAVAILABLE');
        return true;
      }
    );
    assert.strictEqual(geminiCalled, false);
  });

  console.log('\n=== Регрессия квоты модуля бухгалтерии (recognizeAccountingDocument) ===');
  results.forEach(r => {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}`);
    if (!r.ok) console.log(`    ${r.error}`);
  });
  console.log(`\n${failures === 0 ? '✅ Гейт квоты работает как у обычного распознавания' : `❌ Провалов: ${failures}`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Скрипт упал:', err);
  process.exit(1);
});
