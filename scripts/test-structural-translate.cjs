const { test } = require('node:test');
const assert = require('node:assert/strict');

// Регрессионный тест для public/js/translation/structuralDocx.mjs — режим
// "Перевести как есть" (переводит текст ПРЯМО внутри частей .docx —
// word/document.xml и, с 22 сен 2026, колонтитулов word/headerN.xml/
// footerN.xml — не трогая остальную структуру, см. заголовок файла).
//
// Реальный баг, Ethan 19 сен 2026, файл "EN SULTANALIEV AMANEL
// Несудимости.docx" (справка с портала "Тундук", 4 самозакрытых пустых
// абзаца <w:p .../> подряд перед первым абзацем с текстом): регэксп поиска
// абзацев (extractParagraphsFromXml) по ошибке принимал самозакрытый
// пустой <w:p .../> за ОТКРЫВАЮЩИЙ тег обычного абзаца (лениво "проглатывая"
// его финальный "/>" как обычный ">"), а закрывающим для него считал
// </w:p> уже СЛЕДУЮЩЕГО, настоящего абзаца — start/end для перевода
// получались неверными, захватывая границы двух разных узлов <w:p> сразу.
// После склейки (spliceTranslatedParagraphs) это давало невалидный XML —
// реальный Word отказывался открывать файл, хотя сама .docx-упаковка (zip)
// была цела и LibreOffice/минимальные проверки этого не ловили (тот же класс
// симптома, что и баг с <w:tblGrid> в export.mjs/commit 31b1cfc, но другая
// причина и другой код). Исправлено добавлением (?<!\/) перед финальным ">"
// в pRe — самозакрытый пустой абзац теперь просто пропускается (переводить
// в нём нечего), а границы следующего реального абзаца больше не искажаются.
//
// Собирает МИНИМАЛЬНЫЙ настоящий .docx через jszip (тот же приём, что
// scripts/test-translation-docs.cjs использует для globalThis.JSZip) —
// без реального файла Ethan, но с той же структурой XML, что и вызвала баг.

function minimalDocumentXml(bodyXml) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    bodyXml +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
}

function minimalFooterXml(bodyXml) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + bodyXml + '</w:ftr>';
}

async function buildDocx(bodyXml, footerBodyXml) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', minimalDocumentXml(bodyXml));
  if (footerBodyXml !== undefined) zip.file('word/footer1.xml', minimalFooterXml(footerBodyXml));
  return zip.generateAsync({ type: 'nodebuffer' });
}

// Минимальный стековый разбор корректности вложенности тегов — без внешней
// зависимости (в проекте нет DOM/lxml-парсера в node_modules), но именно
// такая проверка (не просто "zip не битый") поймала реальный баг Ethan:
// счётчик открывающих/закрывающих <w:p> совпадал (регэксп ведь честно нашёл
// пару для каждого), но пары были НЕПРАВИЛЬНО вложены друг в друга —
// ровно то, что здесь и обнаруживается через стек.
function assertWellFormedXml(xml) {
  const tagRe = /<(\/?)([a-zA-Z0-9_:.-]+)([^>]*)>/g;
  const stack = [];
  let match;
  while ((match = tagRe.exec(xml))) {
    const [, closing, name, attrs] = match;
    if (name.startsWith('?') || name.startsWith('!')) continue;
    const selfClosing = attrs.trimEnd().endsWith('/');
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== name) {
        throw new Error(`Несогласованные теги: закрывается ${name} на позиции ${match.index}, но открыт был ${top ? top.name : '(пусто)'}`);
      }
    } else if (!selfClosing) {
      stack.push({ name, pos: match.index });
    }
  }
  if (stack.length) {
    throw new Error(`Незакрытые теги: ${stack.map(s => s.name).join(', ')}`);
  }
}

async function withStructuralDocx(fn) {
  const saved = global.JSZip;
  global.JSZip = require('jszip');
  try {
    const mod = await import('../public/js/translation/structuralDocx.mjs');
    return await fn(mod);
  } finally {
    global.JSZip = saved;
  }
}

// Склеивает ВСЕ части (document.xml + колонтитулы) одним и тем же общим
// translatedById — то, что реально делает panel.js (см. exportDocxBtn).
function spliceAllParts(parts, translatedById, spliceTranslatedParagraphs) {
  return parts.map(part => ({ path: part.path, xml: spliceTranslatedParagraphs(part.documentXml, part.paragraphs, translatedById) }));
}

async function extractPartXmlFromBlob(blob, path) {
  const JSZip = require('jszip');
  const buf = Buffer.from(await blob.arrayBuffer());
  const outZip = await JSZip.loadAsync(buf);
  const file = outZip.file(path);
  return file ? file.async('string') : null;
}

// Ровно та форма, что реально сохраняет Word для пустого абзаца без единого
// run — самозакрывающийся тег, БЕЗ отдельного </w:p>.
const EMPTY_SELFCLOSING_P = '<w:p w14:paraId="7C62C005" w14:textId="2CFAEEF2" w:rsidR="00781D4D" w:rsidRDefault="00781D4D" w:rsidP="000E28F6"/>';
const REAL_PARAGRAPH = '<w:p w14:paraId="0D6736D7" w14:textId="77777777"><w:r><w:t xml:space="preserve">Kyrgyz Republic</w:t></w:r></w:p>';

test('self-closing empty <w:p/> before a real paragraph does not corrupt extraction', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs }) => {
    const buf = await buildDocx(EMPTY_SELFCLOSING_P.repeat(4) + REAL_PARAGRAPH);
    const { parts } = await extractStructuralParagraphs(buf);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].paragraphs.length, 1, 'самозакрытые пустые абзацы не должны попадать в список для перевода');
    assert.equal(parts[0].paragraphs[0].text, 'Kyrgyz Republic');
  });
});

test('splicing after self-closing empty <w:p/> paragraphs produces well-formed XML (real Word would open it)', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs, assembleTranslatedDocx }) => {
    const buf = await buildDocx(EMPTY_SELFCLOSING_P.repeat(4) + REAL_PARAGRAPH + REAL_PARAGRAPH.replace('Kyrgyz Republic', 'Second paragraph').replace('0D6736D7', 'AAAA1111'));
    const { zip, parts } = await extractStructuralParagraphs(buf);
    assert.equal(parts[0].paragraphs.length, 2);
    const translatedById = new Map(parts[0].paragraphs.map(p => [p.id, '[RU] ' + p.text]));
    const spliced = spliceAllParts(parts, translatedById, spliceTranslatedParagraphs);
    assertWellFormedXml(spliced[0].xml);
    const blob = await assembleTranslatedDocx(zip, spliced);
    assert.ok(blob);
  });
});

test('a lone self-closing empty <w:p/> with nothing after it is simply ignored', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs }) => {
    const buf = await buildDocx(REAL_PARAGRAPH + EMPTY_SELFCLOSING_P);
    const { parts } = await extractStructuralParagraphs(buf);
    assert.equal(parts[0].paragraphs.length, 1);
    assert.equal(parts[0].paragraphs[0].text, 'Kyrgyz Republic');
  });
});

// --- Найдено полной проверкой модуля "Перевод", 20 сен 2026 -----------------
// 1) Текстовый блок (<w:txbxContent>) содержит СВОИ <w:p> ВНУТРИ <w:p>
// внешнего абзаца: ленивый регэксп находил закрытие внутреннего и принимал его
// за закрытие внешнего — после склейки XML становился невалидным (Word
// отказывается открывать файл).
// 2) Абзац с текстом И картинкой (логотип/QR, привязанные к первому абзацу) —
// склейка заменяла весь <w:p> одним новым run с текстом, и <w:drawing>
// пропадал вместе с оригинальными run'ами.
const DRAWING_RUN = '<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="logo"/></wp:inline></w:drawing></w:r>';
const TEXTBOX_PARAGRAPH =
  '<w:p><w:r><w:t>Outer text</w:t></w:r><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>' +
  '<w:p><w:r><w:t>Inside the box</w:t></w:r></w:p>' +
  '</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>';

test('a text box (paragraph nested inside a paragraph) keeps the XML well-formed and only its inner text is translated', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs }) => {
    const buf = await buildDocx(REAL_PARAGRAPH + TEXTBOX_PARAGRAPH + REAL_PARAGRAPH.replace('Kyrgyz Republic', 'Last'));
    const { parts } = await extractStructuralParagraphs(buf);
    const paragraphs = parts[0].paragraphs;
    const texts = paragraphs.map(p => p.text);
    assert.ok(texts.includes('Kyrgyz Republic') && texts.includes('Last') && texts.includes('Inside the box'), texts.join(' | '));
    const newXml = spliceTranslatedParagraphs(parts[0].documentXml, paragraphs, new Map(paragraphs.map(p => [p.id, '[RU] ' + p.text])));
    assertWellFormedXml(newXml);
    assert.ok(newXml.includes('[RU] Inside the box') && newXml.includes('[RU] Last'));
  });
});

test('an image anchored inside a paragraph that also has text survives translation', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs }) => {
    const paragraph = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${DRAWING_RUN}<w:r><w:t>Title</w:t></w:r></w:p>`;
    const buf = await buildDocx(paragraph);
    const { parts } = await extractStructuralParagraphs(buf);
    const paragraphs = parts[0].paragraphs;
    const newXml = spliceTranslatedParagraphs(parts[0].documentXml, paragraphs, new Map(paragraphs.map(p => [p.id, 'Заголовок'])));
    assertWellFormedXml(newXml);
    assert.ok(newXml.includes('<w:drawing>') && newXml.includes('name="logo"'), 'картинка потеряна');
    assert.ok(newXml.includes('Заголовок') && !newXml.includes('>Title<'));
    assert.ok(newXml.includes('<w:jc w:val="center"/>'), 'свойства абзаца потеряны');
  });
});

// --- Ethan, 22 сен 2026: три правки поверх режима "Перевести как есть" ----

const TABLE_BODY = '<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:tblLayout w:type="autofit"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>Сумма, сом</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>600,00</w:t></w:r></w:p></w:tc></w:tr>' +
  '</w:tbl>' + REAL_PARAGRAPH;

test('table layout is forced to "fixed" — translated (longer) text can no longer widen the table past the page', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs, assembleTranslatedDocx }) => {
    const buf = await buildDocx(TABLE_BODY);
    const { zip, parts } = await extractStructuralParagraphs(buf);
    const translatedById = new Map(parts[0].paragraphs.map(p => [p.id, 'Second paragraph']));
    const spliced = spliceAllParts(parts, translatedById, spliceTranslatedParagraphs);
    const blob = await assembleTranslatedDocx(zip, spliced);
    const outXml = await extractPartXmlFromBlob(blob, 'word/document.xml');
    assertWellFormedXml(outXml);
    // autofit заменяется на fixed, а не просто добавляется рядом — иначе
    // Word видит оба и поведение непредсказуемо.
    assert.ok(!/w:tblLayout\s+w:type="autofit"/.test(outXml), 'autofit должен быть заменён, не оставлен');
    assert.ok(/<w:tblPr>[\s\S]*?<w:tblLayout w:type="fixed"\/>[\s\S]*?<\/w:tblPr>/.test(outXml));
    // Ширины колонок (tblGrid) — то, что вообще заставляет "fixed" работать — не тронуты.
    assert.ok(outXml.includes('<w:gridCol w:w="2000"/>'));
    // tblW тоже форсируется в явную ширину (сумма tblGrid) — иначе Word
    // игнорирует "fixed" при type="auto" и всё равно считает ширину таблицы
    // по содержимому (второй репорт того же бага, Ethan, 22 сен 2026).
    assert.ok(!/w:tblW\s+w:type="auto"/.test(outXml), 'tblW auto должен быть заменён на явную ширину');
    assert.ok(/<w:tblW w:type="dxa" w:w="4000"\/>/.test(outXml), 'tblW должна получить сумму ширин колонок (2000+2000)');
  });
});

test('table WITHOUT an explicit tblLayout also gets forced to "fixed" (default is otherwise autofit)', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs, assembleTranslatedDocx }) => {
    const bodyNoLayout = '<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' + REAL_PARAGRAPH;
    const buf = await buildDocx(bodyNoLayout);
    const { zip, parts } = await extractStructuralParagraphs(buf);
    const translatedById = new Map(parts[0].paragraphs.map(p => [p.id, 'Translated']));
    const spliced = spliceAllParts(parts, translatedById, spliceTranslatedParagraphs);
    const blob = await assembleTranslatedDocx(zip, spliced);
    const outXml = await extractPartXmlFromBlob(blob, 'word/document.xml');
    assertWellFormedXml(outXml);
    assert.ok(outXml.includes('<w:tblLayout w:type="fixed"/>'));
  });
});

test('translator certification is appended at the end for the "translate as-is" mode, before </w:body>, structure otherwise untouched', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs, assembleTranslatedDocx }) => {
    const buf = await buildDocx(REAL_PARAGRAPH);
    const { zip, parts } = await extractStructuralParagraphs(buf);
    const translatedById = new Map(parts[0].paragraphs.map(p => [p.id, 'Kyrgyz Republic (EN)']));
    const spliced = spliceAllParts(parts, translatedById, spliceTranslatedParagraphs);
    const certification = { translatorName: 'Иванова Айгуль Бакытовна', sourceLanguage: 'ru' };
    const blob = await assembleTranslatedDocx(zip, spliced, certification, 'en');
    const outXml = await extractPartXmlFromBlob(blob, 'word/document.xml');
    assertWellFormedXml(outXml);
    assert.ok(outXml.includes('Иванова Айгуль Бакытовна'), 'ФИО переводчика должно попасть в документ');
    assert.ok(outXml.includes('This translation') || outXml.includes('hereby certified'), 'формулировка заверения должна присутствовать');
    // Приписка идёт ПОСЛЕ переведённого содержимого и ДО </w:sectPr></w:body> — не ломает структуру раздела.
    const bodyIdx = outXml.indexOf('Kyrgyz Republic (EN)');
    const certIdx = outXml.indexOf('Иванова Айгуль Бакытовна');
    const sectPrIdx = outXml.indexOf('<w:sectPr>');
    assert.ok(bodyIdx > -1 && certIdx > bodyIdx, 'приписка должна идти ПОСЛЕ переведённого текста');
    assert.ok(sectPrIdx > -1 && certIdx < sectPrIdx, 'приписка должна идти ДО свойств раздела документа');
  });
});

test('no certification is appended when no translator name is set (unchanged default behaviour)', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs, assembleTranslatedDocx }) => {
    const buf = await buildDocx(REAL_PARAGRAPH);
    const { zip, parts } = await extractStructuralParagraphs(buf);
    const translatedById = new Map(parts[0].paragraphs.map(p => [p.id, 'Kyrgyz Republic (EN)']));
    const spliced = spliceAllParts(parts, translatedById, spliceTranslatedParagraphs);
    const blob = await assembleTranslatedDocx(zip, spliced, undefined, 'en');
    const outXml = await extractPartXmlFromBlob(blob, 'word/document.xml');
    assertWellFormedXml(outXml);
    assert.ok(!outXml.includes('This translation') && !outXml.includes('hereby certified'));
  });
});

// --- Ethan, 22 сен 2026: реальный случай — текст в футере оставался
// непереведённым, потому что extractStructuralParagraphs раньше смотрела
// только на word/document.xml. -----------------------------------------

test('footer text (word/footer1.xml) is found, translated and written back — not just word/document.xml', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs, assembleTranslatedDocx }) => {
    const footerBody = '<w:p><w:r><w:t xml:space="preserve">Тест модуля перевода</w:t></w:r></w:p>';
    const buf = await buildDocx(REAL_PARAGRAPH, footerBody);
    const { zip, parts } = await extractStructuralParagraphs(buf);
    assert.equal(parts.length, 2, 'должны найтись обе части — document.xml и footer1.xml');
    const bodyPart = parts.find(p => p.path === 'word/document.xml');
    const footerPart = parts.find(p => p.path === 'word/footer1.xml');
    assert.ok(bodyPart && footerPart);
    assert.equal(footerPart.paragraphs.length, 1);
    assert.equal(footerPart.paragraphs[0].text, 'Тест модуля перевода');
    // id между частями не пересекаются (иначе перевод одной части перезаписал бы другую).
    assert.notEqual(bodyPart.paragraphs[0].id, footerPart.paragraphs[0].id);

    const translatedById = new Map([
      [bodyPart.paragraphs[0].id, 'Kyrgyz Republic (EN)'],
      [footerPart.paragraphs[0].id, 'Translation module test']
    ]);
    const spliced = spliceAllParts(parts, translatedById, spliceTranslatedParagraphs);
    spliced.forEach(p => assertWellFormedXml(p.xml));
    const blob = await assembleTranslatedDocx(zip, spliced);

    const outDocumentXml = await extractPartXmlFromBlob(blob, 'word/document.xml');
    const outFooterXml = await extractPartXmlFromBlob(blob, 'word/footer1.xml');
    assert.ok(outDocumentXml.includes('Kyrgyz Republic (EN)'));
    assert.ok(outFooterXml.includes('Translation module test'), 'перевод футера должен попасть именно в word/footer1.xml');
    assert.ok(!outFooterXml.includes('Тест модуля перевода'), 'оригинальный русский текст футера не должен остаться');
  });
});

test('a document without any header/footer parts still works exactly as before (no regression)', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs }) => {
    const buf = await buildDocx(REAL_PARAGRAPH); // без footerBodyXml вообще
    const { parts } = await extractStructuralParagraphs(buf);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].path, 'word/document.xml');
  });
});
