#!/usr/bin/env node
// Тест чистой геометрии перевода текстового PDF "на месте"
// (public/js/translationDocs/pdfLayout.mjs, Ethan, 20 сен 2026): склейка
// фрагментов в блоки, выравнивание, подгонка перевода в исходную область.
// Без браузера и без pdf.js — на синтетической странице, повторяющей
// структуру реальной распечатки "Информация о составе семьи" (портал
// "Тундук"): центрированный заголовок, пара подпись/значение, таблица,
// абзац из переносов и подпись, перенесённая на вторую строку.
const assert = require('assert');
const test = require('node:test');

const PAGE = { width: 595, height: 842 };
// грубая метрика: ширина символа = 0.5 кегля (в CJK — 1.0)
const measure = (str, size) => Array.from(str).reduce((sum, ch) => sum + (/[一-鿿]/.test(ch) ? 1 : 0.5) * size, 0);
const item = (str, x, y, size = 10, bold = false) => ({ str, x, y, size, bold, width: measure(str, size) });

function samplePage() {
  return [
    item('ИНФОРМАЦИЯ О СОСТАВЕ СЕМЬИ', 297.5 - measure('ИНФОРМАЦИЯ О СОСТАВЕ СЕМЬИ', 12) / 2, 700, 12, true),
    item('Ф.И.О. заявителя', 62, 660), item('ПЕТРОВА АННА ИВАНОВНА', 330, 660),
    item('Количество членов семьи:', 62, 620), item('2', 330, 620),
    item('Адрес:', 62, 605), item('Г. БИШКЕК', 330, 605),
    // строка таблицы: № | ФИО | родство | дата
    item('1', 70, 560), item('ПЕТРОВ ПЕТР ПЕТРОВИЧ', 130, 560), item('Сын', 330, 560), item('2006-09-20', 450, 560),
    item('Ф.И.О.', 200, 580), item('Степень родства', 320, 580), item('Дата рождения', 450, 580),
    // подпись, перенесённая на вторую строку, и значение из трёх строк
    item('Наименование органа, оказывающего', 62, 500), item('услугу:', 62, 488),
    item('Государственное агентство по делам государственной службы и', 340, 500),
    item('местного самоуправления при Кабинете Министров Кыргызской', 340, 488),
    item('Республики', 340, 476),
    // абзац из двух строк по всей ширине
    item('В случае возникновения вопросов или обнаружения несоответствия данных, просим обратиться в', 62, 440),
    item('соответствующий орган местного самоуправления, предоставившего услугу.', 62, 428)
  ];
}

test('isTranslatable: числа и идентификаторы не переводятся', async () => {
  const { isTranslatable } = await import('../public/js/translationDocs/pdfLayout.mjs');
  for (const text of ['2006-09-20', '26471520805', '№ 5', '  ', '', '12,5 %', 'https://tunduk.kg/verify', 'a@b.kg']) assert.strictEqual(isTranslatable(text), false, text);
  for (const text of ['Сын', 'Ф.И.О.', 'ПИН', 'Г. БИШКЕК, МИКРОРАЙОН 7, Д 42, КВ 9']) assert.strictEqual(isTranslatable(text), true, text);
});

test('buildBlocks: абзацы склеиваются, соседние подписи и ячейки таблицы — нет', async () => {
  const { buildBlocks } = await import('../public/js/translationDocs/pdfLayout.mjs');
  const texts = buildBlocks(samplePage(), PAGE).map(b => b.text);
  assert.ok(texts.includes('Государственное агентство по делам государственной службы и местного самоуправления при Кабинете Министров Кыргызской Республики'), texts.join(' | '));
  assert.ok(texts.includes('Наименование органа, оказывающего услугу:'), 'подпись, перенесённая на вторую строку');
  assert.ok(texts.includes('В случае возникновения вопросов или обнаружения несоответствия данных, просим обратиться в соответствующий орган местного самоуправления, предоставившего услугу.'));
  // подпись "Адрес:" заканчивается двоеточием и не должна прилипать к соседней подписи
  assert.ok(texts.includes('Количество членов семьи:') && texts.includes('Адрес:'));
  // ячейки одной строки — отдельные блоки
  for (const cell of ['Сын', 'ПЕТРОВ ПЕТР ПЕТРОВИЧ', '2006-09-20', 'Степень родства']) assert.ok(texts.includes(cell), cell);
  assert.ok(!texts.some(t => /Ф\.И\.О\. заявителя ПЕТРОВА/.test(t)), 'подпись и значение — разные блоки');
});

test('buildBlocks: заголовок по центру страницы центрируется, подпись — по левому краю, ячейка таблицы — по центру ячейки', async () => {
  const { buildBlocks } = await import('../public/js/translationDocs/pdfLayout.mjs');
  const byText = Object.fromEntries(buildBlocks(samplePage(), PAGE).map(b => [b.text, b]));
  assert.strictEqual(byText['ИНФОРМАЦИЯ О СОСТАВЕ СЕМЬИ'].anchor, 'center');
  assert.strictEqual(byText['Ф.И.О. заявителя'].anchor, 'left');
  assert.strictEqual(byText['Сын'].anchor, 'center');
  assert.strictEqual(byText['Ф.И.О. заявителя'].maxWidth <= 330 - 62, true, 'подпись не заезжает на значение справа');
  assert.strictEqual(byText['ИНФОРМАЦИЯ О СОСТАВЕ СЕМЬИ'].bold, true);
});

test('wrapText/fitBlock: перевод укладывается в исходное число строк, уменьшая кегль; CJK и длинные слова переносятся', async () => {
  const { buildBlocks, fitBlock, wrapText, placeLines, coverRects } = await import('../public/js/translationDocs/pdfLayout.mjs');
  const blocks = buildBlocks(samplePage(), PAGE);
  const agency = blocks.find(b => b.text.startsWith('Государственное'));
  const translated = 'State Agency for Civil Service and Local Self-Government under the Cabinet of Ministers of the Kyrgyz Republic';
  const fit = fitBlock(agency, translated, measure);
  assert.ok(fit.lines.length <= 3 && fit.size >= agency.size * 0.62, JSON.stringify(fit));
  assert.strictEqual(fit.lines.join(' '), translated);
  for (const line of fit.lines) assert.ok(measure(line, fit.size) <= agency.maxWidth + 0.01);
  const placed = placeLines(agency, fit, str => measure(str, fit.size));
  assert.strictEqual(placed[0].y, agency.lines[0].y);
  assert.ok(placed.every((l, i) => i === 0 || l.y < placed[i - 1].y));
  assert.strictEqual(coverRects(agency).length, 3);

  const cjk = wrapText('比什凯克市十月区七号小区', str => measure(str, 10), 50);
  assert.ok(cjk.length > 1 && cjk.join('') === '比什凯克市十月区七号小区');
  const long = wrapText('Pneumonoultramicroscopicsilicovolcanoconiosis', str => measure(str, 10), 60);
  assert.ok(long.length > 1 && long.join('') === 'Pneumonoultramicroscopicsilicovolcanoconiosis');

  // ячейка таблицы: центр сохраняется
  const son = blocks.find(b => b.text === 'Сын');
  const [line] = placeLines(son, fitBlock(son, 'Son', measure), str => measure(str, 10));
  assert.ok(Math.abs(line.x + measure('Son', 10) / 2 - (son.x + son.right) / 2) < 0.01);
});

test('fitBlock: слишком длинный перевод не теряется — занимает лишние строки', async () => {
  const { buildBlocks, fitBlock } = await import('../public/js/translationDocs/pdfLayout.mjs');
  const label = buildBlocks(samplePage(), PAGE).find(b => b.text === 'Адрес:');
  const fit = fitBlock(label, 'Registered residential address of the applicant as recorded in the population register', measure);
  assert.strictEqual(fit.lines.join(' '), 'Registered residential address of the applicant as recorded in the population register');
  assert.ok(fit.lines.length > 1);
});
