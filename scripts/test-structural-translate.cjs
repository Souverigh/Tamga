const { test } = require('node:test');
const assert = require('node:assert/strict');

// Регрессионный тест для public/js/translation/structuralDocx.mjs — режим
// "Перевести как есть" (переводит текст ПРЯМО внутри word/document.xml
// загруженного .docx, не трогая остальную структуру, см. заголовок файла).
//
// Реальный баг, Ethan 19 сен 2026, файл "EN SULTANALIEV AMANEL
// Несудимости.docx" (справка с портала "Тундук", 4 самозакрытых пустых
// абзаца <w:p .../> подряд перед первым абзацем с текстом): регэксп поиска
// абзацев (extractStructuralParagraphs) по ошибке принимал самозакрытый
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

async function buildDocx(bodyXml) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', minimalDocumentXml(bodyXml));
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

// Ровно та форма, что реально сохраняет Word для пустого абзаца без единого
// run — самозакрывающийся тег, БЕЗ отдельного </w:p>.
const EMPTY_SELFCLOSING_P = '<w:p w14:paraId="7C62C005" w14:textId="2CFAEEF2" w:rsidR="00781D4D" w:rsidRDefault="00781D4D" w:rsidP="000E28F6"/>';
const REAL_PARAGRAPH = '<w:p w14:paraId="0D6736D7" w14:textId="77777777"><w:r><w:t xml:space="preserve">Kyrgyz Republic</w:t></w:r></w:p>';

test('self-closing empty <w:p/> before a real paragraph does not corrupt extraction', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs }) => {
    const buf = await buildDocx(EMPTY_SELFCLOSING_P.repeat(4) + REAL_PARAGRAPH);
    const { paragraphs } = await extractStructuralParagraphs(buf);
    assert.equal(paragraphs.length, 1, 'самозакрытые пустые абзацы не должны попадать в список для перевода');
    assert.equal(paragraphs[0].text, 'Kyrgyz Republic');
  });
});

test('splicing after self-closing empty <w:p/> paragraphs produces well-formed XML (real Word would open it)', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs, assembleTranslatedDocx }) => {
    const buf = await buildDocx(EMPTY_SELFCLOSING_P.repeat(4) + REAL_PARAGRAPH + REAL_PARAGRAPH.replace('Kyrgyz Republic', 'Second paragraph').replace('0D6736D7', 'AAAA1111'));
    const { zip, documentXml, paragraphs } = await extractStructuralParagraphs(buf);
    assert.equal(paragraphs.length, 2);
    const translatedById = new Map(paragraphs.map(p => [p.id, '[RU] ' + p.text]));
    const newXml = spliceTranslatedParagraphs(documentXml, paragraphs, translatedById);
    assertWellFormedXml(newXml);
    const blob = await assembleTranslatedDocx(zip, newXml);
    assert.ok(blob);
  });
});

test('a lone self-closing empty <w:p/> with nothing after it is simply ignored', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs }) => {
    const buf = await buildDocx(REAL_PARAGRAPH + EMPTY_SELFCLOSING_P);
    const { paragraphs } = await extractStructuralParagraphs(buf);
    assert.equal(paragraphs.length, 1);
    assert.equal(paragraphs[0].text, 'Kyrgyz Republic');
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
    const { documentXml, paragraphs } = await extractStructuralParagraphs(buf);
    const texts = paragraphs.map(p => p.text);
    assert.ok(texts.includes('Kyrgyz Republic') && texts.includes('Last') && texts.includes('Inside the box'), texts.join(' | '));
    const newXml = spliceTranslatedParagraphs(documentXml, paragraphs, new Map(paragraphs.map(p => [p.id, '[RU] ' + p.text])));
    assertWellFormedXml(newXml);
    assert.ok(newXml.includes('[RU] Inside the box') && newXml.includes('[RU] Last'));
  });
});

test('an image anchored inside a paragraph that also has text survives translation', async () => {
  await withStructuralDocx(async ({ extractStructuralParagraphs, spliceTranslatedParagraphs }) => {
    const paragraph = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${DRAWING_RUN}<w:r><w:t>Title</w:t></w:r></w:p>`;
    const buf = await buildDocx(paragraph);
    const { documentXml, paragraphs } = await extractStructuralParagraphs(buf);
    const newXml = spliceTranslatedParagraphs(documentXml, paragraphs, new Map(paragraphs.map(p => [p.id, 'Заголовок'])));
    assertWellFormedXml(newXml);
    assert.ok(newXml.includes('<w:drawing>') && newXml.includes('name="logo"'), 'картинка потеряна');
    assert.ok(newXml.includes('Заголовок') && !newXml.includes('>Title<'));
    assert.ok(newXml.includes('<w:jc w:val="center"/>'), 'свойства абзаца потеряны');
  });
});
