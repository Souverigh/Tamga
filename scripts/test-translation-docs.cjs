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
    callGemini: async (...args) => {
      const response = await callGeminiImpl(...args);
      if (args[0].requiredFields?.includes('checks')) {
        return { result: { checks: ['signatory_name', 'certified_date', 'apostille_number', 'signature'].map(key => {
          const field = response.result.elements?.find(e => e.key === key) || response.result[key] || {};
          return { key, value: field.value || '', confidence: field.confidence ?? 95 };
        }) } };
      }
      return response;
    },
    GeminiError: class GeminiError extends Error {}
  }
};

let consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 1, pageLimit: 1000 });
let consumeUsageCalls = [];
let getClientConfigImpl = async () => null;
const cflPath = path.join(ROOT, 'lib/customFieldsLookup.js');
require.cache[require.resolve(cflPath)] = {
  id: cflPath, filename: cflPath, loaded: true,
  exports: {
    consumeUsage: (...args) => { consumeUsageCalls.push(args[0]); return consumeUsageImpl(...args); },
    getClientConfig: (...args) => getClientConfigImpl(...args)
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
let translateText = text => `[TR]${text}`;
let reverseTranslations = false;
const translationPath = path.join(ROOT, 'lib/translation.js');
require.cache[require.resolve(translationPath)] = {
  id: translationPath, filename: translationPath, loaded: true,
  exports: {
    validateTranslationRequest: body => body, // проходит как есть — сама валидация не тестируется здесь
    translateSegments: async (request, clientRef) => {
      translateSegmentsCalls.push({ request, clientRef });
      const segments = request.segments.map(s => ({ id: s.id, text: translateText(s.text) }));
      return { segments: reverseTranslations ? segments.reverse() : segments };
    }
  }
};

let lookupTransliterationsCalls = [];
let lookupTransliterationsImpl = async () => ({});
const glossaryPath = path.join(ROOT, 'lib/verifiedTransliterations.js');
require.cache[require.resolve(glossaryPath)] = {
  id: glossaryPath, filename: glossaryPath, loaded: true,
  exports: {
    lookupTransliterations: async (...args) => { lookupTransliterationsCalls.push(args); return lookupTransliterationsImpl(...args); }
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

// "Другое"/клиентские типы — структура документа (см. lib/translationDocs/
// pipeline.js, 17 сен 2026): fields по-прежнему {label,value,raw_text,page,
// confidence}, а весь свободный текст идёт отдельным массивом paragraphs.
function fakeGenericResponse({ docType = 'Другое', fields = [], paragraphs = [] } = {}) {
  return {
    result: { doc_type: docType, fields, paragraphs },
    usage: { promptTokenCount: 15, candidatesTokenCount: 8, totalTokenCount: 23 }
  };
}

async function main() {
  await scenario('Аттестат: пары предмет/оценка сохраняются при обратном порядке ответа, в двух таблицах и экспорте', async () => {
    reverseTranslations = true;
    translateText = text => ({ 'Биология': 'Biology', 'География': 'Geography' })[text] || text;
    callGeminiImpl = async () => ({ result: { doc_type: 'Аттестат', fields: [], paragraphs: [], tables: [
      { section: 'Предметы и оценки', rows: [{ subject: 'Биология', grade: '5', confidence: 95 }, { subject: 'География', grade: '4', confidence: 95 }] },
      { section: 'Итоговые экзамены и оценки', rows: [{ subject: 'География', grade: '3', confidence: 95 }, { subject: 'Биология', grade: '', confidence: 95 }] }
    ] } });
    try {
      const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' });
      assert.deepStrictEqual(result.tables.map(t => t.rows.map(r => [r.subject, r.grade, r.translatedSubject, r.translatedGrade])), [
        [['Биология', '5', 'Biology', '5'], ['География', '4', 'Geography', '4']],
        [['География', '3', 'Geography', '3'], ['Биология', '', 'Biology', '']]
      ]);
      assert.deepStrictEqual(result.paragraphs, []);
      const { buildExportDocs } = await import('../public/js/translationDocs/export-model.mjs');
      const { buildTranslationTxt, buildDocumentXml, buildPrintHtml } = await import('../public/js/translation/export.mjs');
      const { original, translation } = buildExportDocs({ file: { name: 'school.png' }, result: { ...result, doc_type: result.docType } }, 'en');
      for (const paired of [false, true]) {
        const txt = buildTranslationTxt(original, translation, paired);
        assert.ok(txt.includes(paired ? 'Биология\t5\tBiology\t5' : 'Biology\t5'));
        assert.ok(txt.includes(paired ? 'География\t4\tGeography\t4' : 'Geography\t4'));
        for (const output of [buildDocumentXml(original, translation, paired), buildPrintHtml(original, translation, paired)]) {
          assert.ok(output.includes('Biology') && output.includes('Geography'));
          // paired=true идёт через pairedLayoutBlocks (не тронут этой правкой,
          // там section по-прежнему буквально русский); paired=false — через
          // layoutBlocks, где заголовок раздела теперь переведён на язык
          // экспорта (см. TABLE_LABELS/SECTION_TITLE_KEY в export.mjs, 18 сен 2026).
          assert.ok(output.includes(paired ? 'Итоговые экзамены и оценки' : 'Final State Examinations'), 'оба раздела должны экспортироваться');
        }
      }
      assert.strictEqual(result.quality.translation.score, 100, 'пустая исходная оценка не является пропущенным переводом');
    } finally { reverseTranslations = false; translateText = text => `[TR]${text}`; }
  });
  await scenario('Старый аттестат: явные пары восстанавливаются без потери строковых полей', async () => {
    callGeminiImpl = async () => ({ result: { doc_type: 'Аттестат', fields: [
      { label: 'Предметы и оценки', value: 'Биология — 5\nГеография — 4', confidence: 90 },
      { label: 'Итоговые экзамены и оценки', value: 'Биология: 4; География: 3', confidence: 90 }
    ] } });
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' });
    assert.deepStrictEqual(result.tables.map(t => t.rows.map(r => [r.subject, r.grade])), [
      [['Биология', '5'], ['География', '4']], [['Биология', '4'], ['География', '3']]
    ]);
    assert.strictEqual(result.fields.find(f => f.key === 'subjectsAndGrades').value, 'Биология — 5\nГеография — 4');
  });
  await scenario('Неоднозначные старые строки не превращаются в guessed пары; пустые таблицы безопасны', async () => {
    for (const tables of [undefined, [], [{ section: 'Пусто', rows: [] }]]) {
      callGeminiImpl = async () => ({ result: { doc_type: 'Аттестат', tables, fields: [
        { label: 'Предметы и оценки', value: 'Биология, География\n5, 4', confidence: 90 }
      ] } });
      const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' });
      assert.ok(Array.isArray(result.tables));
      assert.strictEqual(result.tables.flatMap(t => t.rows).length, 0);
      assert.strictEqual(result.fields.find(f => f.key === 'subjectsAndGrades').value, 'Биология, География\n5, 4');
    }
  });
  await scenario('Язык оригинала определяется сервером автоматически по каждому документу (source_language от Gemini), а не выбирается клиентом в настройках', async () => {
    // Валидный код от модели долетает как есть (регистр не важен).
    callGeminiImpl = async () => fakeApostilleResponse({ source_language: 'ky' });
    let result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' });
    assert.strictEqual(result.sourceLanguage, 'ky');
    callGeminiImpl = async () => fakeApostilleResponse({ source_language: 'ZH' });
    result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' });
    assert.strictEqual(result.sourceLanguage, 'zh');

    // Отсутствующий/неподдерживаемый код — безопасный дефолт 'ru', не падение.
    for (const source_language of [undefined, '', 'fr', 123]) {
      callGeminiImpl = async () => fakeApostilleResponse({ source_language });
      result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' });
      assert.strictEqual(result.sourceLanguage, 'ru');
    }

    // И долетает через реальный клиентский эндпоинт (panel.js берёт его
    // отсюда для приписки переводчика, а не из /api/client-settings).
    callGeminiImpl = async () => fakeApostilleResponse({ source_language: 'ky' });
    const accessPath = require.resolve('../lib/translationAccess');
    const bodyPath = require.resolve('../lib/multipart');
    const originals = [require.cache[accessPath], require.cache[bodyPath]];
    require.cache[accessPath] = { id: accessPath, filename: accessPath, loaded: true, exports: { requirePaidTranslationClient: async () => 'test-client' } };
    require.cache[bodyPath] = { id: bodyPath, filename: bodyPath, loaded: true, exports: { readRequestBody: async req => req.body } };
    try {
      const endpoint = require('../api/translation-docs/client-recognize');
      const response = { setHeader() {}, status(n) { this.statusCode = n; return this; }, json(data) { this.data = data; } };
      await endpoint({ method: 'POST', body: { image: FAKE_BASE64, mimeType: 'image/png', language: 'en', clientSlug: 'test-client' } }, response);
      assert.strictEqual(response.data.sourceLanguage, 'ky');
    } finally {
      [accessPath, bodyPath].forEach((p, i) => { if (originals[i]) require.cache[p] = originals[i]; else delete require.cache[p]; });
    }
  });
  await scenario('Real client endpoint → panel adapter → downloadable DOCX/TXT, with names/dates/IDs', async () => {
    const { APOSTILLE_FIELDS } = require('../lib/translationDocs/apostille');
    const source = ['Кыргыз Республикасы', '', 'Алманова Т.', 'жетекчи', 'Жарандык абалдын актыларын каттоо органы', '', 'Бишкек шаары', '30.01.2018-ж.', 'Чүй-Бишкек аймактык Башкармалыгы', '54-1', '[seal]', 'Ж.Р. Исмаилов [signature]'];
    const target = ['吉尔吉斯共和国', '', 'Almanova T.', '负责人', '民事身份登记机关', '', '比什凯克市', '30-01-2018', '楚河-比什凯克区域管理局', '54-1', '【印章】', 'Zh.R. Ismailov 【签字】'];
    const dictionary = new Map(source.map((s, i) => [s, target[i]]));
    translateSegmentsCalls = [];
    translateText = text => dictionary.get(text);
    callGeminiImpl = async () => fakeApostilleResponse({ elements: APOSTILLE_FIELDS.map((f, i) => ({ key: f.key, label: f.label, element_type: f.elementType || 'numbered_field', number: f.number || '', value: source[i], raw_text: source[i], confidence: 95 })) });
    const accessPath = require.resolve('../lib/translationAccess');
    const bodyPath = require.resolve('../lib/multipart');
    const originals = [require.cache[accessPath], require.cache[bodyPath]];
    require.cache[accessPath] = { id: accessPath, filename: accessPath, loaded: true, exports: { requirePaidTranslationClient: async () => 'test-client' } };
    require.cache[bodyPath] = { id: bodyPath, filename: bodyPath, loaded: true, exports: { readRequestBody: async req => req.body } };
    const saved = { document: global.document, JSZip: global.JSZip, create: URL.createObjectURL, setTimeout: global.setTimeout };
    try {
      const endpoint = require('../api/translation-docs/client-recognize');
      const response = { setHeader() {}, status(n) { this.statusCode = n; return this; }, json(data) { this.data = JSON.parse(JSON.stringify(data)); } };
      await endpoint({ method: 'POST', body: { image: FAKE_BASE64, mimeType: 'image/png', language: 'zh', clientSlug: 'test-client' } }, response);
      assert.strictEqual(response.statusCode, 200);
      assert.deepStrictEqual(response.data.fields.map(f => f.translated), target);
      assert.strictEqual(response.data.fields[2].translationStatus, 'transliterated');
      assert.strictEqual(response.data.fields[7].translationStatus, 'translated');
      assert.strictEqual(response.data.fields[9].translationStatus, 'preserved');
      const sent = translateSegmentsCalls.flatMap(c => c.request.segments.map(s => s.text));
      for (const i of [2, 7, 9, 10, 11]) assert.ok(!sent.includes(source[i]), 'deterministic values must not reach the translator');
      const { buildExportDocs } = await import('../public/js/translationDocs/export-model.mjs');
      const { exportDocx, exportTxt } = await import('../public/js/translation/export.mjs');
      const { original, translation } = buildExportDocs({ file: { name: 'apostille.png' }, result: response.data }, 'zh');
      const downloads = [];
      let blob;
      global.document = { createElement: () => ({ click() { downloads.push({ name: this.download, blob }); } }) };
      URL.createObjectURL = value => { blob = value; return 'blob:test'; };
      global.setTimeout = () => 0;
      global.JSZip = require('jszip');
      await exportDocx(original, translation, false);
      exportTxt(original, translation, false);
      assert.strictEqual(downloads.length, 2);
      const zip = await global.JSZip.loadAsync(await downloads[0].blob.arrayBuffer());
      const xml = await zip.file('word/document.xml').async('string');
      for (const expected of ['Almanova T.', '30-01-2018', '54-1', 'Zh.R. Ismailov']) assert.ok(xml.includes(expected));
      assert.ok((await downloads[1].blob.text()).includes('30-01-2018'));
    } finally {
      [accessPath, bodyPath].forEach((p, i) => { if (originals[i]) require.cache[p] = originals[i]; else delete require.cache[p]; });
      global.document = saved.document; global.JSZip = saved.JSZip; URL.createObjectURL = saved.create; global.setTimeout = saved.setTimeout;
      translateText = text => `[TR]${text}`;
    }
  });
  await scenario('Chinese apostille translates seal and stamp text without changing source data', async () => {
    const { APOSTILLE_FIELDS } = require('../lib/translationDocs/apostille');
    const source = ['Kyrgyz Republic', '', 'Amanova G.', 'Head', 'Zharandyk abaldyn aktylaryn kattoo bolumu', '', 'Bishkek', '30-01-2018', 'Justice Department', '54-1', '[seal]', 'Zh. R. Ismailov'];
    const target = ['吉尔吉斯共和国', '', 'Amanova G.', '负责人', '民事身份登记机关', '', '比什凯克市', '30-01-2018', '司法局', '54-1', '【印章】', 'Zh. R. Ismailov'];
    const dictionary = new Map(source.map((s, i) => [s, target[i]]));
    dictionary.set('Ministry of Justice', '司法部');
    translateText = text => dictionary.get(text);
    callGeminiImpl = async () => fakeApostilleResponse({ elements: [
      ...APOSTILLE_FIELDS.map((f, i) => ({ key: f.key, label: f.label, element_type: f.elementType || 'numbered_field', number: f.number || '', value: source[i], confidence: 95 })),
      { key: 'stamp_text_1', element_type: 'stamp_text', number: '', label: '', value: 'Ministry of Justice', confidence: 95 }
    ] });
    try {
      const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'zh' });
      assert.deepStrictEqual(result.fields.map(f => f.translated), target);
      assert.strictEqual(result.elements.at(-1).translated, '司法部');
      assert.strictEqual(result.elements.filter(e => e.number).length, 10);
    } finally { translateText = text => `[TR]${text}`; }
  });
  await scenario('Apostille transliterates names and translates authority descriptions', async () => {
    translateSegmentsCalls = [];
    callGeminiImpl = async () => fakeApostilleResponse({
      signatory_name: { value: 'Аманова Г.', confidence: 95 },
      seal_authority: { value: 'Zharandyk abaldyn aktylaryn kattoo bolumu', confidence: 95 }
    });
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' });
    assert.strictEqual(result.fields.find(f => f.key === 'signatory_name').translated, 'Amanova G.');
    assert.strictEqual(result.fields.find(f => f.key === 'signatory_name').translationStatus, 'transliterated');
    assert.ok(translateSegmentsCalls[0].request.segments.some(s => s.text === 'Zharandyk abaldyn aktylaryn kattoo bolumu'));
    assert.strictEqual(result.elements.find(e => e.key === 'seal_authority').translated, '[TR]Zharandyk abaldyn aktylaryn kattoo bolumu');
  });
  await scenario('Глоссарий (личный/общий) переопределяет авто-транслитерацию имени для клиента, но не спрашивается для кыргызского/русского языка', async () => {
    lookupTransliterationsCalls = [];
    lookupTransliterationsImpl = async (clientSlug, originals) => {
      assert.strictEqual(clientSlug, 'acme');
      assert.ok(originals.includes('Аманова Г.'));
      return { 'Аманова Г.': 'Amanova-Custom G.' };
    };
    callGeminiImpl = async () => fakeApostilleResponse({
      signatory_name: { value: 'Аманова Г.', confidence: 95 }
    });
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en', clientSlug: 'acme' });
    assert.strictEqual(result.fields.find(f => f.key === 'signatory_name').translated, 'Amanova-Custom G.');
    assert.strictEqual(result.fields.find(f => f.key === 'signatory_name').translationStatus, 'transliterated');
    assert.strictEqual(lookupTransliterationsCalls.length, 1, 'глоссарий должен спрашиваться ровно один раз (батчем) для языков с латиницей');

    lookupTransliterationsCalls = [];
    lookupTransliterationsImpl = async () => { throw new Error('глоссарий не должен спрашиваться для не-латинского целевого языка'); };
    callGeminiImpl = async () => fakeApostilleResponse({
      signatory_name: { value: 'Аманова Г.', confidence: 95 }
    });
    const ruResult = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'ru', clientSlug: 'acme' });
    assert.strictEqual(lookupTransliterationsCalls.length, 0);
    assert.strictEqual(ruResult.fields.find(f => f.key === 'signatory_name').translated, 'Аманова Г.');
  });
  await scenario('Недоступность глоссария не ломает перевод — обычная транслитерация как раньше', async () => {
    lookupTransliterationsImpl = async () => { throw new Error('Supabase недоступен'); };
    callGeminiImpl = async () => fakeApostilleResponse({
      signatory_name: { value: 'Аманова Г.', confidence: 95 }
    });
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en', clientSlug: 'acme' });
    assert.strictEqual(result.fields.find(f => f.key === 'signatory_name').translated, 'Amanova G.');
    lookupTransliterationsImpl = async () => ({});
  });
  await scenario('Apostille rejects shifted field numbers before translation', async () => {
    callGeminiImpl = async () => fakeApostilleResponse({ elements: [{ key: 'public_document', element_type: 'numbered_field', number: '2', value: '' }] });
    await assert.rejects(recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' }), /apostille|\u0430\u043f\u043e\u0441\u0442\u0438\u043b/i);
  });
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
    assert.strictEqual(byKey.certified_date.translated, '10-09-2026');
    assert.strictEqual(byKey.certified_date.translationStatus, 'translated');
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

  await scenario('"Другое": структура документа переводится абзацами (без поля-заглушки "Прочий текст"), порядок сохраняется, пустые абзацы пропускаются', async () => {
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 1, pageLimit: 1000 });
    translateSegmentsCalls = []; translateText = text => `[TR]${text}`;
    const stdFields = ['Название документа', 'Номер', 'Дата', 'Организация', 'Стороны', 'Предмет', 'Суммы'];
    callGeminiImpl = async () => fakeGenericResponse({
      docType: 'Другое',
      fields: stdFields.map(label => ({ label, value: '', raw_text: '', page: 1, confidence: 80 })),
      paragraphs: [
        { text: 'Первый абзац документа.', page: 1 },
        { text: '', page: 1 },
        { text: 'Второй абзац, идущий следом.', page: 1 }
      ]
    });
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en', clientSlug: 'acme' });
    assert.ok(!result.fields.some(f => f.label === 'Прочий текст'), 'поле-заглушка больше не используется для "Другое"');
    assert.strictEqual(result.paragraphs.length, 2, 'пустой абзац пропущен, остальные два сохранены в порядке документа');
    assert.deepStrictEqual(result.paragraphs.map(p => p.text), ['Первый абзац документа.', 'Второй абзац, идущий следом.']);
    assert.deepStrictEqual(result.paragraphs.map(p => p.translated), ['[TR]Первый абзац документа.', '[TR]Второй абзац, идущий следом.']);
    const paraSegmentIds = translateSegmentsCalls.flatMap(c => c.request.segments.map(s => s.id));
    assert.ok(paraSegmentIds.includes('para_0_0') && paraSegmentIds.includes('para_2_0'), 'id сегмента несёт исходный индекс абзаца в rawResult.paragraphs (до фильтрации пустых)');
  });

  await scenario('Клиентский тип без предопределённых полей — весь текст идёт в paragraphs, fields пуст', async () => {
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 1, pageLimit: 1000 });
    translateSegmentsCalls = []; translateText = text => `[TR]${text}`;
    getClientConfigImpl = async () => ({ customDocTypes: { 'Заявление на визу': { hint: 'a visa application letter' } } });
    callGeminiImpl = async () => fakeGenericResponse({
      docType: 'Заявление на визу',
      fields: [],
      paragraphs: [{ text: 'Прошу выдать визу.', page: 1 }, { text: 'С уважением, заявитель.', page: 1 }]
    });
    try {
      const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en', clientSlug: 'acme' });
      assert.strictEqual(result.docType, 'Заявление на визу');
      assert.strictEqual(result.fields.length, 0, 'клиент не описал полей для своего типа — фиксированных полей нет вообще');
      assert.deepStrictEqual(result.paragraphs.map(p => p.translated), ['[TR]Прошу выдать визу.', '[TR]С уважением, заявитель.']);
    } finally {
      getClientConfigImpl = async () => null;
    }
  });

  await scenario('Длинный абзац режется на сегменты (лимит 1800 симв.) и склеивается обратно по индексу чанка, даже если Gemini вернул чанки в другом порядке', async () => {
    consumeUsageImpl = async () => ({ allowed: true, pagesUsed: 1, pageLimit: 1000 });
    translateSegmentsCalls = [];
    const longText = 'Раз два три четыре пять шесть семь восемь. '.repeat(60); // > 1800 символов
    translateText = text => `[TR:${text.length}]`;
    callGeminiImpl = async () => fakeGenericResponse({ docType: 'Другое', fields: [], paragraphs: [{ text: longText, page: 1 }] });
    // Подменяем translateSegments на один запуск, чтобы вернуть чанки В
    // ОБРАТНОМ порядке — translateSegments не гарантирует порядок ответа,
    // только соответствие id (см. lib/translation.js), поэтому склейка
    // должна опираться на chunkIndex, а не на порядок массива.
    const translationExports = require.cache[require.resolve(translationPath)].exports;
    const originalTranslateSegments = translationExports.translateSegments;
    translationExports.translateSegments = async (request, clientRef) => {
      translateSegmentsCalls.push({ request, clientRef });
      const segs = request.segments.map(s => ({ id: s.id, text: translateText(s.text) }));
      return { segments: segs.reverse() };
    };
    try {
      const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', apiKey: 'fake', language: 'en', clientSlug: 'acme' });
      const paraSegments = translateSegmentsCalls.flatMap(c => c.request.segments).filter(s => s.id.startsWith('para_0_'));
      assert.ok(paraSegments.length > 1, 'длинный абзац должен был разбиться на несколько сегментов');
      assert.ok(paraSegments.every(s => s.text.length <= 1800));
      assert.strictEqual(paraSegments.map(s => s.text).join(''), longText, 'чанки покрывают исходный текст без потерь и без наложений');
      assert.strictEqual(result.paragraphs[0].translated, paraSegments.map(s => translateText(s.text)).join(''), 'склейка идёт по chunkIndex, а не по порядку прихода ответов от Gemini');
    } finally {
      translationExports.translateSegments = originalTranslateSegments;
      translateText = text => `[TR]${text}`;
    }
  });

  // "Информация о составе семьи" (портал "Тундук", Ethan, 19 сен 2026):
  // таблица членов семьи идёт отдельным массивом familyMembers, а не через
  // tables (та схема жёстко привязана к Аттестату) — весь путь от ответа
  // модели до .docx/.txt.
  const familyFields = {
    'Страна выдачи': 'Кыргызская Республика', 'ФИО': 'Иванов Иван Иванович', 'ПИН (ИНН)': '22009200000001',
    'Количество членов семьи': '2', 'Адрес': 'г. Бишкек', 'Орган выдачи': 'Министерство цифрового развития',
    'QR-код': '[qr]', 'Текст на штампе': 'КАЙТАЛАНГАН', 'Дата подписи': '2026-08-05', 'Код подписи': 'ABC123'
  };
  const fakeFamilyResponse = (docType = 'Информация о составе семьи') => ({
    result: {
      doc_type: docType, source_language: 'ru', paragraphs: [],
      fields: Object.entries(familyFields).map(([label, value]) => ({ label, value, raw_text: value, page: 1, confidence: 95 })),
      familyMembers: [
        { fullName: 'Иванов Иван Иванович', relationship: 'Сын', birthDate: '2006-09-20', raw_text: '1 Иванов Иван Иванович Сын 2006-09-20', page: 1, confidence: 93 },
        { fullName: 'Иванова Мария Петровна', relationship: 'Мать', birthDate: '1980-01-05', raw_text: '2 Иванова Мария Петровна Мать 1980-01-05', page: 1, confidence: 91 }
      ]
    },
    usage: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 }
  });
  await scenario('Информация о составе семьи: familyMembers — ФИО транслитерируется, дата нормализуется, степень родства переводится (в обратном порядке ответа)', async () => {
    translateSegmentsCalls = [];
    reverseTranslations = true;
    translateText = text => ({ 'Сын': 'Son', 'Мать': 'Mother' })[text] || `[TR]${text}`;
    callGeminiImpl = async () => fakeFamilyResponse();
    try {
      const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' });
      assert.strictEqual(result.docType, 'Информация о составе семьи');
      assert.deepStrictEqual(result.familyMembers.map(m => [m.translatedFullName, m.translatedRelationship, m.translatedBirthDate]), [
        ['Ivanov Ivan Ivanovich', 'Son', '20-09-2006'],
        ['Ivanova Mariia Petrovna', 'Mother', '05-01-1980']
      ]);
      assert.deepStrictEqual(result.familyMembers.map(m => [m.fullName, m.relationship, m.birthDate]), [
        ['Иванов Иван Иванович', 'Сын', '2006-09-20'], ['Иванова Мария Петровна', 'Мать', '1980-01-05']
      ]);
      const sent = translateSegmentsCalls.flatMap(c => c.request.segments.map(s => s.text));
      assert.ok(sent.includes('Сын') && sent.includes('Мать'));
      assert.ok(!sent.some(text => /Иванов|2006|1980/.test(text)), 'имена и даты членов семьи не уходят в модель перевода');
      const byKey = Object.fromEntries(result.fields.map(f => [f.key, f]));
      assert.strictEqual(byKey.memberCount.translated, '2');
      assert.strictEqual(byKey.memberCount.translationStatus, 'preserved');
      assert.strictEqual(byKey.qrCode.translated, '[QR code]');
      assert.ok(result.quality.translation.totalItems > 0);
    } finally { reverseTranslations = false; translateText = text => `[TR]${text}`; }
  });
  await scenario('familyMembers, присланные моделью для другого типа документа, игнорируются', async () => {
    callGeminiImpl = async () => fakeFamilyResponse('Справка о несудимости');
    const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en' });
    assert.strictEqual(result.docType, 'Справка о несудимости');
    assert.deepStrictEqual(result.familyMembers, []);
  });
  await scenario('Информация о составе семьи: глоссарий применяется к именам членов семьи', async () => {
    lookupTransliterationsCalls = [];
    lookupTransliterationsImpl = async (clientSlug, originals) => {
      assert.ok(originals.includes('Иванова Мария Петровна'));
      return { 'Иванова Мария Петровна': 'Ivanova Mariya Petrovna' };
    };
    callGeminiImpl = async () => fakeFamilyResponse();
    try {
      const result = await recognizeAndTranslateDocument({ base64: FAKE_BASE64, mimeType: 'image/png', language: 'en', clientSlug: 'acme' });
      assert.strictEqual(result.familyMembers[1].translatedFullName, 'Ivanova Mariya Petrovna');
      assert.strictEqual(result.familyMembers[0].translatedFullName, 'Ivanov Ivan Ivanovich');
    } finally { lookupTransliterationsImpl = async () => ({}); }
  });
  await scenario('Информация о составе семьи: эндпоинт → адаптер панели → .docx/.txt с таблицей, QR и штампом', async () => {
    translateText = text => ({ 'Сын': 'Son', 'Мать': 'Mother' })[text] || `[TR]${text}`;
    callGeminiImpl = async () => fakeFamilyResponse();
    const accessPath = require.resolve('../lib/translationAccess');
    const bodyPath = require.resolve('../lib/multipart');
    const originals = [require.cache[accessPath], require.cache[bodyPath]];
    require.cache[accessPath] = { id: accessPath, filename: accessPath, loaded: true, exports: { requirePaidTranslationClient: async () => 'test-client' } };
    require.cache[bodyPath] = { id: bodyPath, filename: bodyPath, loaded: true, exports: { readRequestBody: async req => req.body } };
    try {
      const endpoint = require('../api/translation-docs/client-recognize');
      const response = { setHeader() {}, status(n) { this.statusCode = n; return this; }, json(data) { this.data = JSON.parse(JSON.stringify(data)); } };
      await endpoint({ method: 'POST', body: { image: FAKE_BASE64, mimeType: 'image/png', language: 'en', clientSlug: 'test-client' } }, response);
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.data.familyMembers.length, 2);
      const { buildExportDocs } = await import('../public/js/translationDocs/export-model.mjs');
      const { buildDocumentXml, buildTranslationTxt } = await import('../public/js/translation/export.mjs');
      const { original, translation } = buildExportDocs({ file: { name: 'family.pdf' }, result: response.data }, 'en');
      const xml = buildDocumentXml(original, translation, false);
      for (const expected of ['INFORMATION ON FAMILY COMPOSITION', 'Relationship', 'Ivanov Ivan Ivanovich', 'Ivanova Mariia Petrovna', 'Son', 'Mother', '20-09-2006', '05-01-1980', 'КАЙТАЛАНГАН', '[QR code]', 'Number of family members']) {
        assert.ok(xml.includes(expected), `в .docx нет "${expected}"`);
      }
      assert.ok(!xml.includes('Сын') && !xml.includes('2006-09-20'), 'в переводе не должно остаться исходных значений таблицы');
      // .txt/.html/.pdf для этого типа идут через layoutBlocks (общий путь) — не через .docx-вёрстку.
      const txt = buildTranslationTxt(original, translation, false);
      assert.ok(txt.includes('1\tIvanov Ivan Ivanovich\tSon\t20-09-2006'), txt);
      assert.ok(txt.includes('2\tIvanova Mariia Petrovna\tMother\t05-01-1980'));
      const pairedTxt = buildTranslationTxt(original, translation, true);
      assert.ok(pairedTxt.includes('Сын') && pairedTxt.includes('Son'));
    } finally {
      [accessPath, bodyPath].forEach((p, i) => { if (originals[i]) require.cache[p] = originals[i]; else delete require.cache[p]; });
      translateText = text => `[TR]${text}`;
    }
  });
  await scenario('Информация о составе семьи: без QR/штампа/членов семьи вёрстка не выдумывает их', async () => {
    const { buildFamilyCompositionDocumentXml } = await import('../public/js/translation/familyCompositionDocx.mjs');
    const xml = buildFamilyCompositionDocumentXml({ language: 'ru', fields: [{ key: 'fullName', label: 'ФИО', value: 'IVANOV I.I.' }], familyMembers: [] });
    assert.ok(xml.includes('IVANOV I.I.') && xml.includes('ИНФОРМАЦИЯ О СОСТАВЕ СЕМЬИ'));
    assert.ok(!xml.includes('QR') && !xml.includes('Степень родства'));
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
