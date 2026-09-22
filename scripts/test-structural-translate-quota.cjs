// Регрессия: lib/translationDocs/structuralTranslate.js списывает ВДВОЕ
// больше страниц пакета клиента, чем размер документа (Ethan, 21 сен 2026:
// "для переводческого будет использоваться два раза больше лимита клиента —
// если условно одна страница, то это будет считаться как две страницы").
// Причина: сам перевод (translateSegments, lib/translation.js) теперь делает
// ДВА прогона Gemini на сегмент — перевод и проверочный (см.
// verifyTranslationAccuracy там, добавлено этой же сессией). Этот тест
// проверяет только СЧЁТ списаний (consumeUsage вызывается pageCount*2 раз),
// а не сам перевод — та часть уже покрыта scripts/test-translation.cjs.
//
// Тот же приём мока через require.cache, что scripts/test-translation-docs.cjs.

const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failures = 0;
const results = [];
async function scenario(label, fn) {
  try { await fn(); results.push({ label, ok: true }); }
  catch (err) { failures += 1; results.push({ label, ok: false, error: err.message }); }
}

let consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 1, pageLimit: 1000 });
let consumeUsageCalls = [];
const cflPath = path.join(ROOT, 'lib/customFieldsLookup.js');
require.cache[require.resolve(cflPath)] = {
  id: cflPath, filename: cflPath, loaded: true,
  exports: { consumeUsage: (...args) => { consumeUsageCalls.push(args[0]); return consumeUsageImpl(...args); } }
};

const translationPath = path.join(ROOT, 'lib/translation.js');
require.cache[require.resolve(translationPath)] = {
  id: translationPath, filename: translationPath, loaded: true,
  exports: {
    validateTranslationRequest: body => body,
    translateSegments: async request => ({ segments: request.segments.map(s => ({ id: s.id, text: '[TR]' + s.text })), usage: null })
  }
};

const { translateDocumentSegments } = require(path.join(ROOT, 'lib/translationDocs/structuralTranslate.js'));

(async () => {
  await scenario('.docx (pageCount по умолчанию 1) — 2 списания страницы, не 1', async () => {
    consumeUsageCalls = [];
    await translateDocumentSegments({ segments: [{ id: 'a', text: 'Текст' }], language: 'en', clientSlug: 'acme' });
    assert.strictEqual(consumeUsageCalls.length, 2, 'baseUnits(1) * 2 = 2 списанные страницы');
  });

  await scenario('PDF на месте, pageCount=3 — 6 списаний страницы (3 * 2), не 3', async () => {
    consumeUsageCalls = [];
    await translateDocumentSegments({ segments: [{ id: 'a', text: 'Текст' }], language: 'en', clientSlug: 'acme', pageCount: 3 });
    assert.strictEqual(consumeUsageCalls.length, 6, 'baseUnits(3) * 2 = 6 списанных страниц');
  });

  await scenario('pageCount выше потолка (60) по-прежнему зажимается ДО удвоения — 100, не 120', async () => {
    consumeUsageCalls = [];
    await translateDocumentSegments({ segments: [{ id: 'a', text: 'Текст' }], language: 'en', clientSlug: 'acme', pageCount: 60 });
    assert.strictEqual(consumeUsageCalls.length, 100, 'min(60,50)=50 baseUnits, * 2 = 100');
  });

  await scenario('без clientApiKey/clientSlug — квота вообще не проверяется', async () => {
    consumeUsageCalls = [];
    await translateDocumentSegments({ segments: [{ id: 'a', text: 'Текст' }], language: 'en' });
    assert.strictEqual(consumeUsageCalls.length, 0);
  });

  console.log(results.map(r => `${r.ok ? '✔' : '✖'} ${r.label}${r.ok ? '' : ' — ' + r.error}`).join('\n'));
  if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
})();
