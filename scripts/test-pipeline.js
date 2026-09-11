#!/usr/bin/env node
// Регрессионный тест пайплайна recognizeDocument (Ethan, 10 сен 2026, "тест
// на регрессии пайплайна") — НЕ про точность модели (для этого — eval-accuracy.js,
// который реально ходит в Gemini), а про то, что сам наш код не теряет данные
// по дороге от ответа Gemini до итогового result.
//
// Повод: 9 сен 2026 один и тот же симптом (пустой блок "Итоги документа")
// потребовал 4 последовательных фикса подряд, каждый вскрывал следующий слой
// (схема ответа → промпт → сопоставление лейблов на фронтенде → жёсткое
// обнуление fields в app.js). Ни один из этих слоёв не был защищён тестом —
// баг каждый раз ловился только живым тестом на реальном документе. Этот
// скрипт фиксирует сценарий "totals должны дойти до result.fields" и
// аналогичные для items/warnings, чтобы будущая регрессия такого рода
// ловилась за секунды, а не за отдельную debug-сессию.
//
// Полностью мокает callGemini и getClientConfig через require.cache — реальных
// вызовов к Gemini/Supabase нет, GEMINI_API_KEY не нужен, сеть не используется.

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

// callGeminiImpl — переопределяется каждым сценарием (замыкание), чтобы
// каждый сценарий мог задать свою последовательность ответов (в т.ч. разные
// ответы на первый и на дозапрос за таблицей).
let callGeminiImpl = async () => { throw new Error('callGeminiImpl не задан сценарием'); };
const geminiClientPath = path.join(ROOT, 'lib/geminiClient.js');
require.cache[require.resolve(geminiClientPath)] = {
  id: geminiClientPath, filename: geminiClientPath, loaded: true,
  exports: {
    callGemini: (...args) => callGeminiImpl(...args),
    GeminiError: class GeminiError extends Error {}
  }
};

// getClientConfigImpl — по умолчанию анонимный (null), сценарии переопределяют.
let getClientConfigImpl = async () => null;
let consumedPages = 0;
const cflPath = path.join(ROOT, 'lib/customFieldsLookup.js');
require.cache[require.resolve(cflPath)] = {
  id: cflPath, filename: cflPath, loaded: true,
  exports: {
    getClientConfig: (...args) => getClientConfigImpl(...args),
    consumeUsage: async () => { consumedPages++; return { allowed: true, pagesUsed: 1, pageLimit: 1000 }; }
  }
};

process.env.GEMINI_API_KEY = 'fake-key-for-pipeline-test';
const { recognizeDocument } = require(path.join(ROOT, 'lib/recognize.js'));

const FAKE_BASE64 = Buffer.from('fake-image-bytes').toString('base64');

// --- Сценарии -------------------------------------------------------------

async function main() {
  await scenario('Клиентский тип: подсказка, точные поля, одно списание за два этапа', async () => {
    consumedPages = 0;
    const calls = [];
    getClientConfigImpl = async () => ({ customDocTypes: {
      'Страховка': { hint: 'Insurance card', fields: ['Номер полиса'] }
    }, businessRules: [] });
    callGeminiImpl = async args => {
      calls.push(args);
      return { result: calls.length === 1 ? { documentType: 'Страховка' } : {
        fields: [{ label: 'Номер полиса', value: '123', confidence: 99 }], confidence: 99
      }, usage: null };
    };
    const r = await recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg', clientSlug: 'test-client' });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(consumedPages, 1);
    assert.ok(calls[0].instruction.includes('Insurance card'));
    assert.ok(calls[0].instruction.includes('Номер полиса'));
    assert.ok(calls[1].instruction.includes('Номер полиса'));
    assert.strictEqual(r.documentType, 'Страховка');
    assert.strictEqual(r.fields[0].value, '123');
  });
  for (const type of ['Справка', 'Счёт-фактура / Инвойс']) {
    for (const includeText of [true, false]) {
      await scenario(`Авто: только классификация, затем ${type}, text=${includeText}`, async () => {
        const calls = [];
        getClientConfigImpl = async () => null;
        callGeminiImpl = async args => {
          calls.push(args);
          return { result: calls.length === 1 ? { documentType: type } : {
            text: 'Полный текст', fields: [], items: [], confidence: 94
          }, usage: null };
        };
        const r = await recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg', includeText });
        assert.strictEqual(calls.length, 2);
        assert.deepStrictEqual(Object.keys(calls[0].schemaProperties), ['documentType']);
        assert.deepStrictEqual(calls[0].requiredFields, ['documentType']);
        assert.ok(!calls[1].schemaProperties.documentType);
        assert.strictEqual(!!calls[1].schemaProperties.text, includeText);
        assert.strictEqual(calls[1].base64, FAKE_BASE64);
        assert.strictEqual(r.text, includeText ? 'Полный текст' : '');
        assert.strictEqual(r.documentType, type);
        assert.strictEqual(r.confidence, 94);
      });
    }
  }
  await scenario('Ошибка второго этапа не превращается в пустой успешный результат', async () => {
    let calls = 0;
    callGeminiImpl = async () => {
      if (++calls === 1) return { result: { documentType: 'Счёт-фактура / Инвойс' }, usage: null };
      throw new Error('extraction failed');
    };
    await assert.rejects(recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg' }), /extraction failed/);
  });
  await scenario('Некорректная классификация останавливает извлечение', async () => {
    let calls = 0;
    callGeminiImpl = async () => { calls++; return { result: { documentType: 'несуществующий тип' }, usage: null }; };
    await assert.rejects(recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg' }), /классификац/);
    assert.strictEqual(calls, 1);
  });
  await scenario('Карточный тип (известный docType): fields доходят до result', async () => {
    callGeminiImpl = async () => ({
      result: {
        fields: [{ label: 'ФИО', value: 'Иванов Иван Иванович', confidence: 95 }],
        confidence: 95
      },
      usage: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }
    });
    getClientConfigImpl = async () => null;

    const r = await recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg', docType: 'Справка' });
    assert.strictEqual(r.documentType, 'Справка');
    assert.deepStrictEqual(r.fields, [{ label: 'ФИО', value: 'Иванов Иван Иванович', confidence: 95 }]);
    assert.deepStrictEqual(r.items, []);
    assert.deepStrictEqual(r.warnings, []);
    assert.strictEqual(r.columns, undefined, 'карточный тип не должен нести columns');
  });

  await scenario('Табличный тип с totals, docType известен ЗАРАНЕЕ (один вызов): items И totals доходят', async () => {
    callGeminiImpl = async () => ({
      result: {
        items: [{ name: 'Бумага А4', id: '', price: '420,00', qty: '12', sum: '5040,00', vatRate: '', vatSum: '' }],
        fields: [
          { label: 'Сумма без НДС', value: '5040,00', confidence: 98 },
          { label: 'Ставка НДС', value: '12%', confidence: 98 },
          { label: 'Сумма НДС', value: '604,80', confidence: 98 },
          { label: 'Итого с НДС', value: '5644,80', confidence: 98 }
        ],
        confidence: 98
      },
      usage: { promptTokenCount: 50, candidatesTokenCount: 30, totalTokenCount: 80 }
    });
    getClientConfigImpl = async () => null;

    const r = await recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg', docType: 'Счёт-фактура / Инвойс' });
    assert.strictEqual(r.items.length, 1, 'items не дошли');
    assert.strictEqual(r.fields.length, 4, 'totals (fields) не дошли — тот самый баг 9 сен');
    assert.strictEqual(r.fields.find(f => f.label === 'Итого с НДС').value, '5644,80');
    assert.ok(Array.isArray(r.columns) && r.columns.length, 'columns должны присутствовать для табличного типа');
  });

  await scenario('Табличный тип с totals, docType НЕИЗВЕСТЕН (авто-детект, два вызова): totals доходят после дозапроса', async () => {
    let callCount = 0;
    callGeminiImpl = async () => {
      callCount += 1;
      if (callCount === 1) {
        // Первый вызов — только классификация, items/totals физически не
        // просили в схеме (см. buildInstructionAndSchema: tableMode требует
        // ЗАРАНЕЕ известный тип) — Gemini может вернуть fields пустым, это
        // нормально для этого шага.
        return {
          result: { documentType: 'Счёт-фактура / Инвойс', fields: [], confidence: 92 },
          usage: { promptTokenCount: 60, candidatesTokenCount: 5, totalTokenCount: 65 }
        };
      }
      // Дозапрос за таблицей — ИМЕННО здесь исторически терялись totals.
      return {
        result: {
          items: [{ name: 'Картридж', id: '', price: '2650,00', qty: '3', sum: '7950,00', vatRate: '', vatSum: '' }],
          fields: [
            { label: 'Сумма без НДС', value: '7950,00', confidence: 97 },
            { label: 'Ставка НДС', value: '12%', confidence: 97 },
            { label: 'Сумма НДС', value: '954,00', confidence: 97 },
            { label: 'Итого с НДС', value: '8904,00', confidence: 97 }
          ],
          confidence: 97
        },
        usage: { promptTokenCount: 55, candidatesTokenCount: 25, totalTokenCount: 80 }
      };
    };
    getClientConfigImpl = async () => null;

    const r = await recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg' }); // docType не передан
    assert.strictEqual(callCount, 2, 'ожидалось ровно 2 вызова Gemini (классификация + дозапрос)');
    assert.strictEqual(r.documentType, 'Счёт-фактура / Инвойс');
    assert.strictEqual(r.items.length, 1, 'items после дозапроса не дошли');
    assert.strictEqual(r.fields.length, 4, 'totals после дозапроса не дошли — та самая регрессия 9 сен, теперь на автодетекте');
    assert.strictEqual(r.fields.find(f => f.label === 'Итого с НДС').value, '8904,00');
  });

  await scenario('Бизнес-правило видит totals ПОСЛЕ дозапроса за таблицей (реальный кейс Ethan)', async () => {
    let callCount = 0;
    callGeminiImpl = async () => {
      callCount += 1;
      if (callCount === 1) {
        return { result: { documentType: 'Счёт-фактура / Инвойс', fields: [], confidence: 90 }, usage: null };
      }
      return {
        result: {
          items: [{ name: 'X', id: '', price: '1', qty: '1', sum: '1', vatRate: '', vatSum: '' }],
          fields: [
            { label: 'Сумма без НДС', value: '16170,00', confidence: 99 },
            { label: 'Ставка НДС', value: '12%', confidence: 99 },
            { label: 'Сумма НДС', value: '1940,40', confidence: 99 },
            { label: 'Итого с НДС', value: '18110,40', confidence: 99 }
          ],
          confidence: 99
        },
        usage: null
      };
    };
    getClientConfigImpl = async () => ({
      fields: null, fieldOverrides: null, customDocTypes: null, formatting: null,
      pageLimit: null, pagesUsed: 0, displayName: null, logoUrl: null, accentColor: null,
      maxConcurrency: null, passwordHash: null,
      businessRules: [{ type: 'percentage_match', baseField: 'Сумма без НДС', valueField: 'Сумма НДС', expectedPercent: 15, tolerancePercent: 1, level: 'error' }]
    });

    const r = await recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg', clientSlug: 'test-client' });
    assert.strictEqual(r.warnings.length, 1, 'warnings должны считаться от totals, полученных ПОСЛЕ дозапроса, а не от пустого fields первого вызова');
    assert.ok(r.warnings[0].message.includes('не похоже на 15%'));
  });

  await scenario('Нечитаемый документ (__unparsed): консистентная форма ответа, без исключений', async () => {
    callGeminiImpl = async () => ({
      result: { __unparsed: 'нечитаемый мусор от модели' },
      usage: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 }
    });
    getClientConfigImpl = async () => null;

    const r = await recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg', docType: 'Справка' });
    assert.strictEqual(r.documentType, 'Справка');
    assert.deepStrictEqual(r.fields, []);
    assert.deepStrictEqual(r.items, []);
    assert.deepStrictEqual(r.warnings, [], 'warnings должен быть пустым массивом, не undefined, даже при __unparsed');
    assert.strictEqual(r.text, 'нечитаемый мусор от модели');
  });

  await scenario('Анонимный вызов (нет clientSlug/apiKey): не падает, warnings=[]', async () => {
    callGeminiImpl = async () => ({
      result: { fields: [{ label: 'ФИО', value: 'Тест', confidence: 80 }], confidence: 80 },
      usage: null
    });
    getClientConfigImpl = async () => { throw new Error('getClientConfig НЕ должен вызываться для анонимного посетителя'); };

    const r = await recognizeDocument({ base64: FAKE_BASE64, mimeType: 'image/jpeg', docType: 'Справка' });
    assert.deepStrictEqual(r.warnings, []);
  });

  console.log('\n=== Регрессия пайплайна recognizeDocument ===');
  results.forEach(r => {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}`);
    if (!r.ok) console.log(`    ${r.error}`);
  });
  console.log(`\n${failures === 0 ? '✅ Пайплайн не теряет данные' : `❌ Провалов: ${failures}`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Скрипт упал:', err);
  process.exit(1);
});
