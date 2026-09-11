#!/usr/bin/env node
// Проверка синхронности дублирующихся модулей сервер/клиент (Ethan,
// 10 сен 2026, "защита от рассинхрона дублей").
//
// В проекте намеренно нет бандлера (см. README/архитектурные заметки) —
// поэтому есть пары файлов, которые ДОЛЖНЫ содержать одну и ту же логику,
// но живут раздельно (серверная CommonJS-копия для recognizeDocument/промпта,
// клиентская ES-module-копия для офлайн-режима и мгновенной перепроверки в
// браузере без round-trip на сервер):
//   - lib/docSchema.js          ↔ public/js/config/docSchema.js
//   - lib/postprocess/businessRules.js ↔ public/js/postprocess/businessRules.js
//
// Этот скрипт НЕ проверяет корректность самой логики (для этого —
// test-pipeline.js и eval-accuracy.js) — только то, что обе копии одной пары
// ведут себя ОДИНАКОВО на одних и тех же входных данных. Расхождение здесь
// почти всегда значит: кто-то поправил один файл пары и забыл про другой.
//
// Не требует GEMINI_API_KEY и не ходит в сеть — чистая проверка логики.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  ✗ ${label}`);
    console.log(`    ${err.message}`);
  }
}

async function checkDocSchemaConsistency() {
  console.log('\n=== docSchema.js: сервер ↔ клиент ===');
  const server = require(path.join(ROOT, 'lib/docSchema.js'));
  const client = await import(pathToFileURL(path.join(ROOT, 'public/js/config/docSchema.js')).href);

  check('DOC_TYPES — одинаковый список и порядок', () => {
    assert.deepStrictEqual(client.DOC_TYPES, server.DOC_TYPES);
  });

  check('DOC_FIELDS — одинаковая структура для каждого типа', () => {
    assert.deepStrictEqual(client.DOC_FIELDS, server.DOC_FIELDS);
  });

  server.DOC_TYPES.forEach(docType => {
    check(`isTableType/columnsForType/keysForType/totalsForType совпадают: "${docType}"`, () => {
      assert.strictEqual(client.isTableType(docType), server.isTableType(docType), 'isTableType');
      assert.deepStrictEqual(client.columnsForType(docType), server.columnsForType(docType), 'columnsForType');
      assert.deepStrictEqual(client.keysForType(docType), server.keysForType(docType), 'keysForType');
      assert.deepStrictEqual(client.totalsForType(docType), server.totalsForType(docType), 'totalsForType');
    });
  });
}

// Фикстуры для businessRules — покрывают все 5 настраиваемых типов правил +
// оба встроенных (дата выдачи/окончания). Значения подобраны так, чтобы
// КАЖДОЕ правило реально сработало (иначе тест мог бы пройти просто потому,
// что обе копии молча ничего не проверили).
const BUSINESS_RULES_FIXTURES = [
  {
    label: 'percentage_match (12% вместо ожидаемых 15%, реальный кейс Ethan 9 сен)',
    fields: [
      { label: 'Сумма без НДС', value: '16170,00' },
      { label: 'Сумма НДС', value: '1940,40' }
    ],
    rules: [{ type: 'percentage_match', baseField: 'Сумма без НДС', valueField: 'Сумма НДС', expectedPercent: 15, tolerancePercent: 1, level: 'error' }],
    docType: 'Счёт-фактура / Инвойс'
  },
  {
    label: 'percentage_match БЕЗ явного tolerancePercent — задевает DEFAULT_TOLERANCE_PERCENT',
    fields: [
      { label: 'Сумма без НДС', value: '1000' },
      { label: 'Сумма НДС', value: '150' }
    ],
    rules: [{ type: 'percentage_match', baseField: 'Сумма без НДС', valueField: 'Сумма НДС', expectedPercent: 12, level: 'error' }],
    docType: 'Счёт-фактура / Инвойс'
  },
  {
    label: 'sum_match (строки не сходятся с итогом)',
    fields: [
      { label: 'Позиция 1', value: '100' },
      { label: 'Позиция 2', value: '50' },
      { label: 'Итого', value: '200' }
    ],
    rules: [{ type: 'sum_match', sumFields: ['Позиция 1', 'Позиция 2'], targetField: 'Итого', tolerancePercent: 1, level: 'error' }],
    docType: 'Накладная / УПД'
  },
  {
    label: 'date_order (клиентское правило, дата А позже даты Б)',
    fields: [
      { label: 'Дата А', value: '15.03.2026' },
      { label: 'Дата Б', value: '01.01.2026' }
    ],
    rules: [{ type: 'date_order', earlierField: 'Дата А', laterField: 'Дата Б', level: 'error' }],
    docType: 'Другое'
  },
  {
    label: 'required_field (поле пустое)',
    fields: [{ label: 'ИНН', value: '' }],
    rules: [{ type: 'required_field', field: 'ИНН', level: 'error' }],
    docType: 'Справка'
  },
  {
    label: 'range_check (значение вне диапазона)',
    fields: [{ label: 'Возраст', value: '150' }],
    rules: [{ type: 'range_check', field: 'Возраст', min: 0, max: 120, level: 'error' }],
    docType: 'Другое'
  },
  {
    label: 'встроенное правило: дата выдачи позже даты окончания',
    fields: [
      { label: 'Дата выдачи', value: '01.01.2030' },
      { label: 'Дата окончания', value: '01.01.2025' }
    ],
    rules: [],
    docType: 'Паспорт / удостоверение личности'
  },
  {
    label: 'docTypes-фильтр правила (не должно сработать — тип не совпадает)',
    fields: [{ label: 'ИНН', value: '' }],
    rules: [{ type: 'required_field', field: 'ИНН', level: 'error', docTypes: ['Справка'] }],
    docType: 'Другое'
  },
  {
    label: 'пустые/некорректные поля — обе копии молча пропускают, без исключений',
    fields: [],
    rules: [{ type: 'percentage_match', baseField: 'Нет такого поля', valueField: 'И такого нет', expectedPercent: 10 }],
    docType: null
  }
];

async function checkBusinessRulesConsistency() {
  console.log('\n=== businessRules.js: сервер ↔ клиент ===');
  const server = require(path.join(ROOT, 'lib/postprocess/businessRules.js'));
  const client = await import(pathToFileURL(path.join(ROOT, 'public/js/postprocess/businessRules.js')).href);

  BUSINESS_RULES_FIXTURES.forEach(({ label, fields, rules, docType }) => {
    check(label, () => {
      const serverResult = server.checkBusinessRules(fields, rules, docType);
      const clientResult = client.checkBusinessRules(fields, rules, docType);
      assert.deepStrictEqual(clientResult, serverResult);
    });
  });
}

async function main() {
  await checkDocSchemaConsistency();
  await checkBusinessRulesConsistency();

  console.log(`\n${failures === 0 ? '✅ Все копии синхронны' : `❌ Расхождений: ${failures}`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Скрипт упал:', err);
  process.exit(1);
});
