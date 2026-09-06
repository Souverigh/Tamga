#!/usr/bin/env node
// Быстрая проверка кастомного списка полей (tamga_api_key_fields в Supabase)
// на реальном проде — без Postman/curl, одной командой.
//
// Использование:
//   TAMGA_TEST_API_KEY=<твой ключ> node scripts/test-custom-fields.js путь/к/фото.jpg [docType]
//
// docType необязателен, по умолчанию "Паспорт / удостоверение личности" —
// но кастомные поля применяются, только если docType передан и известен
// (см. lib/recognize.js), так что для реальной проверки лучше указывать
// тот тип, для которого настроен tamga_api_key_fields.
//
// Опционально: TAMGA_TEST_URL, если проверяешь не прод, а другой деплой
// (по умолчанию https://tamga-souverigh.vercel.app).

const fs = require('fs');
const path = require('path');

const [, , filePath, docTypeArg] = process.argv;

if (!filePath) {
  console.error('Использование: TAMGA_TEST_API_KEY=<ключ> node scripts/test-custom-fields.js путь/к/фото.jpg [docType]');
  process.exit(1);
}

const apiKey = process.env.TAMGA_TEST_API_KEY;
if (!apiKey) {
  console.error('Не задан TAMGA_TEST_API_KEY. Пример запуска:');
  console.error('  TAMGA_TEST_API_KEY=твой_ключ node scripts/test-custom-fields.js photo.jpg "Паспорт / удостоверение личности"');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error('Файл не найден:', filePath);
  process.exit(1);
}

const baseUrl = process.env.TAMGA_TEST_URL || 'https://tamga-souverigh.vercel.app';
const docType = docTypeArg || 'Паспорт / удостоверение личности';

function mimeTypeForFile(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

async function main() {
  const base64 = fs.readFileSync(filePath).toString('base64');
  const mimeType = mimeTypeForFile(filePath);

  console.log(`Отправляю ${filePath} (${mimeType}) на ${baseUrl}/api/v1/recognize с docType="${docType}"...\n`);

  const res = await fetch(`${baseUrl}/api/v1/recognize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({ image: base64, mimeType, docType })
  });

  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.error('Не удалось разобрать ответ как JSON. Статус:', res.status);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Ошибка (HTTP ${res.status}):`, data.error || data);
    process.exit(1);
  }

  console.log('Тип документа:', data.documentType);
  console.log('\nПолученные поля:');
  if (Array.isArray(data.fields) && data.fields.length) {
    for (const f of data.fields) {
      console.log(`  ${f.label}: ${f.value || '(пусто)'}`);
    }
    console.log(`\nВсего полей: ${data.fields.length}`);
    console.log('Если это НЕ полный стандартный список для этого типа документа (см. DOC_FIELDS в lib/docSchema.js),');
    console.log('а именно тот урезанный набор, что ты вписал в tamga_api_key_fields.fields — кастомизация работает.');
  } else {
    console.log('  (пусто — либо табличный тип, либо Gemini не нашёл полей)');
  }

  if (Array.isArray(data.items) && data.items.length) {
    console.log(`\nТабличные строки (items): ${data.items.length}`);
    if (Array.isArray(data.columns) && data.columns.length) {
      console.log('Колонки:', data.columns.join(', '));
      console.log('Если это НЕ стандартный набор колонок для этого типа (см. DOC_FIELDS в lib/docSchema.js),');
      console.log('а кастомный список из tamga_api_key_fields.field_overrides — переопределение колонок работает.');
    }
  }
}

main().catch(err => {
  console.error('Скрипт упал:', err.message);
  process.exit(1);
});
