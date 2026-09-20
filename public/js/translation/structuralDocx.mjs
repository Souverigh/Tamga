// public/js/translation/structuralDocx.mjs — режим "Перевести как есть"
// модуля "Перевод" (Ethan, 19 сен 2026: "чтобы человек мог загружать .docx
// и переводить их же — разбить на части, перевести, склеить обратно").
//
// Отличие от остального модуля "Перевод" (pipeline.js): там документ сперва
// КЛАССИФИЦИРУЕТСЯ по типу и из него ИЗВЛЕКАЮТСЯ ПОЛЯ, а итоговый .docx
// собирается заново по НАШЕМУ шаблону (birthCertificateDocx.mjs и т.п.) —
// визуально похож на образец бюро, но не идентичен оригинальному файлу.
// Здесь — прямо противоположный, более простой путь: текст переводится
// ПРЯМО ВНУТРИ оригинального word/document.xml загруженного файла, поэтому
// итоговый .docx сохраняет структуру оригинала один в один (таблицы,
// колонки, картинки, разрывы страниц — всё, что не текст, не трогается
// вообще). Не нужен ни новый тип в TYPE_REGISTRY, ни свой рендерер — работает
// для ЛЮБОГО .docx с настоящим текстом, не только для уже поддержанных типов.
//
// Сознательное упрощение (тот же принцип, что у остальных рендереров модуля:
// "визуальные параметры, не литеральная копия"): весь текст одного абзаца
// заменяется ОДНИМ новым run с оформлением ПЕРВОГО run исходного абзаца —
// если внутри абзаца было несколько кусков с РАЗНЫМ форматированием (напр.
// одно слово жирным посреди обычного предложения), после перевода всё
// становится одним стилем. Так же теряются гиперссылки/закладки внутри
// абзаца (весь узел <w:p> перестраивается заново). Для типичных официальных
// документов (справки, письма, договоры) это почти не заметно — абзац как
// правило набран одним стилем целиком. Таблицы/колонки/изображения/разрывы
// страниц не трогаются вообще, т.к. лежат СНАРУЖИ узла <w:p>.
//
// Использует тот же JSZip (уже подключён через CDN, public/js/ocr/docxLoader.js
// использует его же для чтения .docx, export.mjs — для записи) — отдельная
// npm-библиотека для "разбить/перевести/склеить" не нужна: всё делается
// напрямую над XML текстовыми узлами <w:t>, ровно то, что описывал Ethan.

function decodeXmlEntities(text) {
  // Тот же порядок замен, что уже используется в docxLoader.js — на
  // практике безопасно, т.к. document.xml не содержит двойного экранирования.
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

// Собирает текст одного абзаца из его <w:t>-узлов (в порядке появления),
// подставляя \t на месте <w:tab/> и \n на месте <w:br/> — то же самое, что
// делает docxLoader.js для всего документа, здесь — в границах одного
// абзаца, с сохранением позиций для последующей склейки перевода обратно.
// Возвращает null, если в абзаце нет НИ ОДНОГО настоящего текстового узла
// (абзац с одной картинкой/разрывом страницы и т.п. — трогать нечего).
function extractParagraphText(inner) {
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>/g;
  let text = '';
  let found = false;
  let match;
  while ((match = tokenRe.exec(inner))) {
    if (match[0].startsWith('<w:tab')) text += '\t';
    else if (match[0].startsWith('<w:br')) text += '\n';
    else { text += decodeXmlEntities(match[1] || ''); found = true; }
  }
  return found ? text : null;
}

// Оформление (<w:rPr>) первого run'а абзаца, содержащего настоящий текст —
// используется для нового run'а с переводом, чтобы шрифт/жирность/размер
// совпадали с оригиналом (см. упрощение в шапке файла).
function firstRunRPr(inner) {
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let match;
  while ((match = runRe.exec(inner))) {
    if (/<w:t(?:\s[^>]*)?>/.test(match[1])) {
      const rpr = match[1].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
      return rpr ? rpr[0] : '';
    }
  }
  return '';
}

// Распаковывает .docx и возвращает список переводимых абзацев с их
// позициями в исходном word/document.xml (нужны для точечной замены на
// этапе склейки) — вместе с самим zip и XML-строкой, которые splice-функция
// ниже примет обратно.
export async function extractStructuralParagraphs(file) {
  if (!globalThis.JSZip) throw new Error('Модуль DOCX не загрузился. Обновите страницу.');
  const zip = await globalThis.JSZip.loadAsync(file);
  const documentXmlFile = zip.file('word/document.xml');
  if (!documentXmlFile) throw new Error('Файл повреждён или не является документом Word (.docx)');
  const documentXml = await documentXmlFile.async('string');

  const paragraphs = [];
  // (?<!\/) перед финальным ">" — реальный кейс, Ethan 19 сен 2026, файл
  // "EN SULTANALIEV AMANEL Несудимости.docx" (справка с портала "Тундук"):
  // Word сам сохраняет ПУСТОЙ абзац (без ни единого run) самозакрывающимся
  // тегом <w:p .../> (в этом файле их 4 подряд). Без исключения самозакрытия
  // регэксп по ошибке принимал ТАКОЙ тег за ОТКРЫВАЮЩИЙ (лениво "проглатывая"
  // финальный "/>" как обычный ">"), а закрывающим для него считал </w:p>
  // СЛЕДУЮЩЕГО, уже настоящего абзаца — то есть start/end для перевода
  // получались неверными и захватывали два разных узла <w:p> сразу. При
  // последующей склейке (spliceTranslatedParagraphs) это давало НЕВАЛИДНЫЙ
  // XML: реальный Word отказывался открывать файл ("Word experienced an
  // error trying to open the file"), хотя сама .docx-упаковка (zip) была
  // цела — тот же класс симптома, что и баг с <w:tblGrid> (см. коммит
  // 31b1cfc), но полностью другая причина и другой код (structuralDocx.mjs,
  // не export.mjs/docxLayoutEngine.mjs). Подтверждено: python-docx поднимал
  // lxml.etree.XMLSyntaxError "Opening and ending tag mismatch" на реальном
  // файле Ethan именно на границе первого такого самозакрытого абзаца.
  // Атрибут не может оканчиваться на голый "/" перед ">" в валидном XML (все
  // значения атрибутов в кавычках), поэтому lookbehind однозначно отличает
  // самозакрытие от обычного открывающего тега. Самозакрытый пустой абзац
  // просто не попадает в paragraphs (переводить нечего) — структура вокруг
  // него в документе не трогается вообще, как и раньше для любого другого
  // нетекстового узла.
  const pRe = /<w:p(\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/w:p>/g;
  let match;
  let index = 0;
  while ((match = pRe.exec(documentXml))) {
    const [full, rawAttrs, inner] = match;
    const attrs = rawAttrs || '';
    const pprMatch = inner.match(/^(<w:pPr>[\s\S]*?<\/w:pPr>)/);
    const pPrXml = pprMatch ? pprMatch[1] : '';
    const bodyInner = pprMatch ? inner.slice(pprMatch[1].length) : inner;
    const text = extractParagraphText(bodyInner);
    if (text === null || !text.trim()) continue;
    paragraphs.push({
      id: `p${index}`,
      text,
      start: match.index,
      end: match.index + full.length,
      attrs, pPrXml,
      rPrXml: firstRunRPr(bodyInner)
    });
    index += 1;
  }
  // Сообщение этой ошибки — служебный маркер, по нему translateOne (см.
  // translationDocs/panel.js) молча откатывается на обычное распознавание
  // (умеет доставать картинку из .docx) вместо показа ошибки человеку —
  // текст ниже не должен меняться на что-то, что не содержит эту фразу.
  if (!paragraphs.length) {
    throw new Error('В документе не найдено переводимого текста — возможно, это скан, вставленный как картинка.');
  }
  return { zip, documentXml, paragraphs };
}

function buildRun(text, rPrXml) {
  const body = escapeXml(text)
    .replace(/\t/g, '</w:t><w:tab/><w:t xml:space="preserve">')
    .replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  return `<w:r>${rPrXml}<w:t xml:space="preserve">${body}</w:t></w:r>`;
}

// Вставляет переведённый текст обратно в исходный XML — по индексам,
// записанным extractStructuralParagraphs. Идём С КОНЦА документа к началу,
// иначе после первой же замены (перевод почти всегда другой длины, чем
// оригинал) все последующие индексы окажутся неверными.
export function spliceTranslatedParagraphs(documentXml, paragraphs, translatedById) {
  let xml = documentXml;
  for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
    const p = paragraphs[i];
    const translated = translatedById.get(p.id);
    if (translated === undefined || !translated.trim()) continue; // не пришёл перевод — оставляем оригинал как есть, не портим документ
    const replacement = `<w:p${p.attrs}>${p.pPrXml}${buildRun(translated, p.rPrXml)}</w:p>`;
    xml = xml.slice(0, p.start) + replacement + xml.slice(p.end);
  }
  return xml;
}

export async function assembleTranslatedDocx(zip, newDocumentXml) {
  zip.file('word/document.xml', newDocumentXml);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
