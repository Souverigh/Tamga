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

import { certificationBlocks } from './export.mjs';

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
    else if (match[0].startsWith('<w:br')) {
      // разрыв страницы/колонки — не перевод строки: он сохраняется отдельно
      // (см. preservedRuns) и не должен превращаться в "\n" в тексте перевода
      if (!/w:type="(?:page|column)"/.test(match[0])) text += '\n';
    }
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

// Run'ы абзаца, которые НЕ являются текстом и должны пережить замену текста
// (найдено полной проверкой модуля 20 сен 2026: склейка заменяла весь <w:p>
// одним новым run с переводом, и логотип/QR, привязанные к абзацу с текстом,
// пропадали вместе с оригинальными run'ами; в шапке файла было обещано
// обратное — что картинки лежат "снаружи" абзаца). Сохраняем картинки и
// фигуры, элементы полей (fldChar/instrText — иначе поле теряет начало или
// конец) и разрывы страницы/колонки. Run, где картинка стоит рядом с
// текстом, сохраняется БЕЗ своих <w:t> — иначе оригинальный текст остался бы
// рядом с переводом. Всё, что было ДО первого run с текстом, остаётся перед
// переводом, всё остальное — после него.
const PRESERVE_RUN_RE = /<w:(?:drawing|pict|object|fldChar|instrText)\b|<mc:AlternateContent\b|<w:br\s[^>]*w:type="(?:page|column)"/;
function preservedRuns(inner) {
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  const runs = [];
  let match;
  while ((match = runRe.exec(inner))) {
    runs.push({ xml: match[0], hasText: /<w:t(?:\s[^>]*)?>/.test(match[1]), keep: PRESERVE_RUN_RE.test(match[1]) });
  }
  const firstText = runs.findIndex(run => run.hasText);
  let before = '', after = '';
  runs.forEach((run, i) => {
    if (!run.keep) return;
    const xml = run.hasText ? run.xml.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, '') : run.xml;
    if (firstText === -1 || i < firstText) before += xml; else after += xml;
  });
  return { before, after };
}

// Извлекает переводимые абзацы из ОДНОЙ xml-строки части пакета .docx
// (word/document.xml, ИЛИ word/headerN.xml/footerN.xml — структура <w:p>
// внутри одинаковая что в <w:body>, что в <w:hdr>/<w:ftr>, регэкспы ниже не
// завязаны на конкретный корневой узел). idPrefix — чтобы id абзацев из
// РАЗНЫХ частей пакета не пересекались друг с другом при сборке одного
// общего запроса на перевод (см. extractStructuralParagraphs ниже) — должен
// содержать только [a-zA-Z0-9_-], тот же алфавит, что и весь id целиком
// (см. SEGMENT_ID_RE в lib/translationDocs/structuralTranslate.js).
function extractParagraphsFromXml(xml, idPrefix) {
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
  // Абзацы ищем с учётом вложенности (найдено полной проверкой модуля 20 сен
  // 2026): в текстовом блоке (<w:txbxContent>) СВОИ <w:p> лежат ВНУТРИ <w:p>
  // внешнего абзаца. Ленивый регэксп находил закрытие внутреннего и принимал
  // его за закрытие внешнего — после склейки XML получался невалидным (Word
  // отказывается открывать такой файл). Теперь считаем стек открытий/закрытий
  // и переводим только "листовые" абзацы (без вложенных <w:p>) — их замена
  // всегда корректна; внешний абзац с текстовым блоком не трогаем вовсе
  // (его собственный текст, если он есть, останется в оригинале).
  // Самозакрытый <w:p .../> (см. комментарий выше) — не открытие абзаца.
  const tagRe = /<w:p(?:\s[^>]*?)?(?<!\/)>|<\/w:p>/g;
  const open = [];
  const leaves = [];
  let tag;
  while ((tag = tagRe.exec(xml))) {
    if (tag[0] === '</w:p>') {
      const paragraph = open.pop();
      if (paragraph && !paragraph.hasChild) leaves.push({ ...paragraph, end: tag.index + tag[0].length });
    } else {
      if (open.length) open[open.length - 1].hasChild = true;
      open.push({ start: tag.index, openTag: tag[0], innerStart: tag.index + tag[0].length, hasChild: false });
    }
  }
  leaves.sort((x, y) => x.start - y.start);
  let index = 0;
  for (const leaf of leaves) {
    const attrs = leaf.openTag.slice('<w:p'.length, -1);
    const inner = xml.slice(leaf.innerStart, leaf.end - '</w:p>'.length);
    const pprMatch = inner.match(/^(<w:pPr>[\s\S]*?<\/w:pPr>)/);
    const pPrXml = pprMatch ? pprMatch[1] : '';
    const bodyInner = pprMatch ? inner.slice(pprMatch[1].length) : inner;
    const text = extractParagraphText(bodyInner);
    if (text === null || !text.trim()) continue;
    const kept = preservedRuns(bodyInner);
    paragraphs.push({
      id: `${idPrefix}${index}`,
      text,
      start: leaf.start,
      end: leaf.end,
      attrs, pPrXml,
      rPrXml: firstRunRPr(bodyInner),
      beforeXml: kept.before,
      afterXml: kept.after
    });
    index += 1;
  }
  return paragraphs;
}

// Распаковывает .docx и возвращает список переводимых абзацев по КАЖДОЙ
// части пакета, где может быть видимый пользователю текст — не только
// word/document.xml (основное тело), но и колонтитулы word/headerN.xml/
// word/footerN.xml (Ethan, 22 сен 2026: реальный случай — текст в футере
// документа "Тест модуля перевода • 1" оставался непереведённым, потому что
// раньше эта функция смотрела только на document.xml). Части без единого
// переводимого абзаца (обычная ситуация для колонтитула с одним номером
// страницы через поле, без текста) просто не попадают в parts — как раньше
// вело бы себя отсутствие текста в document.xml.
export async function extractStructuralParagraphs(file) {
  if (!globalThis.JSZip) throw new Error('Модуль DOCX не загрузился. Обновите страницу.');
  const zip = await globalThis.JSZip.loadAsync(file);
  const documentXmlFile = zip.file('word/document.xml');
  if (!documentXmlFile) throw new Error('Файл повреждён или не является документом Word (.docx)');

  const partFiles = [documentXmlFile, ...zip.file(/^word\/(?:header|footer)\d+\.xml$/)];
  const parts = [];
  for (let partIndex = 0; partIndex < partFiles.length; partIndex += 1) {
    const xml = await partFiles[partIndex].async('string');
    const paragraphs = extractParagraphsFromXml(xml, `part${partIndex}_p`);
    if (paragraphs.length) parts.push({ path: partFiles[partIndex].name, documentXml: xml, paragraphs });
  }
  // Сообщение этой ошибки — служебный маркер, по нему translateOne (см.
  // translationDocs/panel.js) молча откатывается на обычное распознавание
  // (умеет доставать картинку из .docx) вместо показа ошибки человеку —
  // текст ниже не должен меняться на что-то, что не содержит эту фразу.
  if (!parts.length) {
    throw new Error('В документе не найдено переводимого текста — возможно, это скан, вставленный как картинка.');
  }
  return { zip, parts };
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
    const replacement = `<w:p${p.attrs}>${p.pPrXml}${p.beforeXml || ''}${buildRun(translated, p.rPrXml)}${p.afterXml || ''}</w:p>`;
    xml = xml.slice(0, p.start) + replacement + xml.slice(p.end);
  }
  return xml;
}

// Форсирует фиксированную раскладку таблиц (w:tblLayout type="fixed") —
// реальный случай, Ethan, 22 сен 2026: таблица "съезжает" за край страницы
// после перевода на английский, хотя структура (tblGrid/tcW — ширины колонок)
// вообще не менялась. Причина — таблицы Word по умолчанию (или явно
// w:tblLayout type="autofit"/отсутствие тега) пересчитывают ширины колонок
// ПО СОДЕРЖИМОМУ при каждом открытии файла; более длинный английский текст в
// переводимых ячейках (тот же "Amount, som" вместо "Сумма, сом") раздувает
// таблицу шире печатной области. type="fixed" заставляет Word строго
// уважать уже заданные в файле ширины — текст просто переносится внутри
// ячейки, как и должно быть при переводе "как есть" без изменения вёрстки.
//
// Одного w:tblLayout type="fixed" оказалось недостаточно (тот же баг всё
// ещё воспроизводится, Ethan, 22 сен 2026, второй репорт: таблица всё ещё
// съезжает за край страницы). По спецификации OOXML фиксированная раскладка
// применяется только когда у самой таблицы (w:tblW) задана ЯВНАЯ ширина —
// если w:tblW остаётся type="auto" (типичный экспорт из Word/LibreOffice),
// Word игнорирует "fixed" и всё равно считает общую ширину таблицы по
// содержимому. Поэтому здесь дополнительно считаем сумму ширин колонок из
// w:tblGrid и прописываем её в w:tblW как явную ширину в твипах (dxa).
function forceFixedTableLayout(xml) {
  return xml.replace(/<w:tbl>([\s\S]*?)<\/w:tbl>/g, (fullMatch, tblInner) => {
    const gridSum = [...tblInner.matchAll(/<w:gridCol\s+w:w="(\d+)"/g)]
      .reduce((sum, m) => sum + parseInt(m[1], 10), 0);
    const patchedInner = tblInner.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/, (match, inner) => {
      let next = /<w:tblLayout\b/.test(inner)
        ? inner.replace(/<w:tblLayout\b[^>]*\/>/, '<w:tblLayout w:type="fixed"/>')
        : `${inner}<w:tblLayout w:type="fixed"/>`;
      if (gridSum > 0) {
        next = /<w:tblW\b/.test(next)
          ? next.replace(/<w:tblW\b[^>]*\/>/, `<w:tblW w:type="dxa" w:w="${gridSum}"/>`)
          : `${next}<w:tblW w:type="dxa" w:w="${gridSum}"/>`;
      }
      return `<w:tblPr>${next}</w:tblPr>`;
    });
    return `<w:tbl>${patchedInner}</w:tbl>`;
  });
}

// Вставляет готовый XML абзацев ПЕРЕД свойствами раздела документа
// (<w:sectPr>, прямой потомок <w:body>, должен оставаться ПОСЛЕДНИМ элементом
// body) — если она распознана НЕПОСРЕДСТВЕННО перед </w:body> (стандартный
// случай для простого документа с одним разделом). Иначе — просто перед
// </w:body>: реже встречающиеся многораздельные документы (sectPr внутри
// pPr абзаца посреди текста) не трогаем этим регэкспом намеренно — риск
// сломать структуру выше пользы для редкого случая.
function appendParagraphsToBody(documentXml, paragraphsXml) {
  if (!paragraphsXml) return documentXml;
  const m = documentXml.match(/(<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>|<w:sectPr(?:\s[^>]*)?\/>)(\s*<\/w:body>)/);
  if (m) {
    const idx = documentXml.indexOf(m[0]);
    return documentXml.slice(0, idx) + paragraphsXml + m[1] + m[2] + documentXml.slice(idx + m[0].length);
  }
  const bodyEnd = documentXml.lastIndexOf('</w:body>');
  if (bodyEnd === -1) return documentXml; // защитно — неожиданная структура, не трогаем вообще
  return documentXml.slice(0, bodyEnd) + paragraphsXml + documentXml.slice(bodyEnd);
}

// Приписка переводчика для режима "Перевести как есть" (Ethan, 22 сен 2026:
// "для Word документов нужна в конце приписка... при этом сохраняя структуру
// оригинала") — раньше этот режим был единственным во всём модуле "Перевод"
// без блока заверения вообще (см. шапку файла, старое "без блока
// нотариального заверения" было осознанным решением 19 сен, но не учитывало
// этот запрос). certificationBlocks() — та же функция и тот же формат (два
// абзаца: язык оригинала, потом язык перевода — компания/контакты + "Настоящий
// перевод... выполнен переводчиком ИМЯ." + "Достоверность подтверждается."),
// что использует остальной модуль (export.mjs) — только здесь она рендерится
// в сырой OOXML и ДОБАВЛЯЕТСЯ в конец оригинального документа, а не строит
// документ с нуля.
function certificationParagraphXml(text) {
  const rPr = '<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>';
  return `<w:p>${buildRun(text, rPr)}</w:p>`;
}
function buildCertificationXml(certification, targetLanguage) {
  const blocks = certificationBlocks(certification, targetLanguage);
  if (!blocks.length) return '';
  return '<w:p/>' + blocks.map(b => certificationParagraphXml(b.text)).join('');
}

// parts — [{path, xml}], уже склеенные вызывающим кодом через
// spliceTranslatedParagraphs (по одному вызову на часть — word/document.xml
// И каждый переведённый колонтитул). Приписка переводчика добавляется
// ТОЛЬКО в основное тело документа (word/document.xml) — в колонтитуле ей
// не место, она и так печатается на каждой странице сама по себе.
export async function assembleTranslatedDocx(zip, parts, certification, targetLanguage) {
  for (const { path, xml: partXml } of parts) {
    let xml = forceFixedTableLayout(partXml);
    if (path === 'word/document.xml') {
      xml = appendParagraphsToBody(xml, buildCertificationXml(certification, targetLanguage));
    }
    zip.file(path, xml);
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
