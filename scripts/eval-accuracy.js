#!/usr/bin/env node
// Замер реальной точности распознавания на эталонном наборе документов.
// См. eval/README.md за инструкцией по использованию.
//
// Не трогает прод и не проходит через сеть — вызывает recognizeDocument()
// напрямую (тот же код, что использует сайт и публичный API), с локальным
// GEMINI_API_KEY. Реальные вызовы к Gemini API, реальный расход квоты.

const fs = require('fs');
const path = require('path');

const { recognizeDocument } = require('../lib/recognize');
const { isTableType } = require('../lib/docSchema');

const ROOT = path.join(__dirname, '..');
const GROUND_TRUTH_PATH = path.join(ROOT, 'eval', 'ground-truth.json');
const DOCUMENTS_DIR = path.join(ROOT, 'eval', 'documents');
const RESULTS_DIR = path.join(ROOT, 'eval', 'results');

// Без внешних зависимостей (в проекте их принципиально нет) — свой мини-загрузчик
// .env, на случай если GEMINI_API_KEY не экспортирован в окружение вручную.
function loadDotEnvIfNeeded() {
  if (process.env.GEMINI_API_KEY) return;
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

function mimeTypeForFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg'; // .jpg/.jpeg по умолчанию
}

// Нормализация перед сравнением — только тримминг пробелов и схлопывание
// повторных пробелов. Специально НЕ трогаем регистр и не пытаемся быть умнее:
// цель инструмента — честная цифра, а не подгонка сравнения под то, что удобно.
function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function compareFields(expectedFields, actualFields) {
  // actualFields — массив [{label, value}], как возвращает recognizeDocument.
  const actualMap = new Map(actualFields.map(f => [f.label, f.value]));
  const mismatches = [];
  let correct = 0;
  const total = Object.keys(expectedFields).length;
  for (const [label, expectedValue] of Object.entries(expectedFields)) {
    const actualValue = actualMap.has(label) ? actualMap.get(label) : undefined;
    if (normalize(actualValue) === normalize(expectedValue)) {
      correct += 1;
    } else {
      mismatches.push({ field: label, expected: expectedValue, actual: actualValue ?? '(поле отсутствует в ответе)' });
    }
  }
  return { correct, total, mismatches };
}

function compareItems(expectedItems, actualItems) {
  // Сравнение построчно по индексу — см. предупреждение в eval/README.md
  // про табличные типы (порядок/количество строк может сбить сравнение).
  const mismatches = [];
  let correct = 0;
  let total = 0;
  const maxLen = Math.max(expectedItems.length, actualItems.length);
  for (let i = 0; i < maxLen; i++) {
    const expectedRow = expectedItems[i];
    const actualRow = actualItems[i];
    if (!expectedRow) continue; // лишние строки от модели не штрафуем как отдельную категорию здесь
    for (const [key, expectedValue] of Object.entries(expectedRow)) {
      total += 1;
      const actualValue = actualRow ? actualRow[key] : undefined;
      if (normalize(actualValue) === normalize(expectedValue)) {
        correct += 1;
      } else {
        mismatches.push({ field: `строка ${i + 1}.${key}`, expected: expectedValue, actual: actualValue ?? '(строка отсутствует в ответе)' });
      }
    }
  }
  return { correct, total, mismatches };
}

async function evaluateOne(entry) {
  const filePath = path.join(DOCUMENTS_DIR, entry.file);
  if (!fs.existsSync(filePath)) {
    return { file: entry.file, error: `Файл не найден: ${filePath}` };
  }
  const base64 = fs.readFileSync(filePath).toString('base64');
  const mimeType = mimeTypeForFile(entry.file);

  // Тот же двухшаговый путь, что и в public/js/app.js для авто-детекта:
  // сначала классификация+текст без известного типа, и если определился
  // табличный тип — второй запрос за items с уже известным типом.
  const first = await recognizeDocument({ base64, mimeType, docType: undefined });
  let fields = first.fields;
  let items = first.items;
  if (isTableType(first.documentType)) {
    const second = await recognizeDocument({ base64, mimeType, docType: first.documentType, skipOcr: true });
    items = second.items;
  }

  const docTypeCorrect = first.documentType === entry.docType;
  const result = {
    file: entry.file,
    expectedDocType: entry.docType,
    actualDocType: first.documentType,
    docTypeCorrect
  };

  if (!docTypeCorrect) {
    // Если тип определён неверно, сравнение полей/строк не имеет смысла —
    // они извлекались под неправильную схему полей.
    result.fieldsSkipped = 'Тип определён неверно — поля не сравнивались';
    return result;
  }

  if (entry.fields) {
    result.fieldsCheck = compareFields(entry.fields, fields);
  }
  if (entry.items) {
    result.itemsCheck = compareItems(entry.items, items);
  }
  return result;
}

function printMismatches(label, mismatches) {
  if (!mismatches.length) return;
  console.log(`    Расхождения (${label}):`);
  for (const m of mismatches) {
    console.log(`      • ${m.field}: ожидалось "${m.expected}", пришло "${m.actual}"`);
  }
}

async function main() {
  loadDotEnvIfNeeded();
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY не найден — экспортируй его в терминале или положи в .env (см. eval/README.md).');
    process.exit(1);
  }
  if (!fs.existsSync(GROUND_TRUTH_PATH)) {
    console.error(`Не найден ${GROUND_TRUTH_PATH}. Скопируй eval/ground-truth.example.json в eval/ground-truth.json и заполни своими документами (см. eval/README.md).`);
    process.exit(1);
  }

  const groundTruth = JSON.parse(fs.readFileSync(GROUND_TRUTH_PATH, 'utf8')).filter(e => !e._skip);
  console.log(`Запускаю проверку на ${groundTruth.length} документах...\n`);

  const results = [];
  for (const entry of groundTruth) {
    process.stdout.write(`  ${entry.file}... `);
    try {
      const result = await evaluateOne(entry);
      results.push(result);
      if (result.error) {
        console.log(`ОШИБКА: ${result.error}`);
        continue;
      }
      console.log(result.docTypeCorrect ? `тип верно (${result.actualDocType})` : `тип НЕВЕРНО: ожидался "${result.expectedDocType}", пришёл "${result.actualDocType}"`);
      if (result.fieldsCheck) {
        console.log(`    Поля: ${result.fieldsCheck.correct}/${result.fieldsCheck.total}`);
        printMismatches('поля', result.fieldsCheck.mismatches);
      }
      if (result.itemsCheck) {
        console.log(`    Ячейки таблицы: ${result.itemsCheck.correct}/${result.itemsCheck.total}`);
        printMismatches('таблица', result.itemsCheck.mismatches);
      }
    } catch (err) {
      console.log(`ОШИБКА ВЫЗОВА: ${err.message}`);
      results.push({ file: entry.file, error: err.message });
    }
  }

  // Агрегация
  const withoutErrors = results.filter(r => !r.error);
  const docTypeCorrectCount = withoutErrors.filter(r => r.docTypeCorrect).length;
  const byType = {};
  for (const r of withoutErrors) {
    const key = r.expectedDocType || '(не указан)';
    byType[key] = byType[key] || { total: 0, correct: 0 };
    byType[key].total += 1;
    if (r.docTypeCorrect) byType[key].correct += 1;
  }

  let fieldsCorrectSum = 0, fieldsTotalSum = 0;
  let itemsCorrectSum = 0, itemsTotalSum = 0;
  for (const r of withoutErrors) {
    if (r.fieldsCheck) { fieldsCorrectSum += r.fieldsCheck.correct; fieldsTotalSum += r.fieldsCheck.total; }
    if (r.itemsCheck) { itemsCorrectSum += r.itemsCheck.correct; itemsTotalSum += r.itemsCheck.total; }
  }

  console.log('\n=== Итог ===');
  console.log(`Классификация типа: ${docTypeCorrectCount}/${withoutErrors.length} (${withoutErrors.length ? Math.round(100 * docTypeCorrectCount / withoutErrors.length) : 0}%)`);
  console.log('По типам:');
  for (const [type, stat] of Object.entries(byType)) {
    console.log(`  ${type}: ${stat.correct}/${stat.total} (${Math.round(100 * stat.correct / stat.total)}%)`);
  }
  if (fieldsTotalSum) {
    console.log(`Поля (карточные типы): ${fieldsCorrectSum}/${fieldsTotalSum} (${Math.round(100 * fieldsCorrectSum / fieldsTotalSum)}%)`);
  }
  if (itemsTotalSum) {
    console.log(`Ячейки таблиц: ${itemsCorrectSum}/${itemsTotalSum} (${Math.round(100 * itemsCorrectSum / itemsTotalSum)}%)`);
  }
  if (results.some(r => r.error)) {
    console.log(`\nОшибки вызова (не учтены в проценте): ${results.filter(r => r.error).length}`);
  }

  // Сохраняем полный отчёт для сравнения между запусками.
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const reportPath = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  console.log(`\nПолный отчёт сохранён: ${path.relative(ROOT, reportPath)}`);
}

main().catch(err => {
  console.error('Скрипт упал:', err);
  process.exit(1);
});
