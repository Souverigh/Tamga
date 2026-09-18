// public/js/ocr/docxLoader.js — извлечение содержимого .docx для
// распознавания без OCR (Ethan, 18 сен 2026: "чтобы человек тоже мог
// скидывать формат [.docx]", уточнено через AskUserQuestion — пока
// подключено только к вкладке "Перевод"/типу "Аттестат", с автоматическим
// откатом на обычное распознавание по картинке, если внутри .docx на самом
// деле скан).
//
// Настоящий текстовый .docx даёт Gemini чистый текст без ошибок OCR — точнее
// и дешевле распознавания по фото (см. lib/geminiClient.js — режим
// sourceText уже существовал для перевода сегментов, здесь он же
// используется и для самого распознавания). Если реального текста мало
// (человек просто вставил скан как картинку в Word-файл), достаём эту
// картинку прямо из архива .docx (word/media/...) и распознаём её как
// обычное фото — тот же путь, что уже работает для JPEG/PNG, без рендеринга
// страницы средствами браузера (которого у нас и нет).
//
// Порог "мало текста" (MIN_TEXT_LENGTH) — намеренно не нулевой: пустой или
// почти пустой document.xml (пара строк колонтитула на пустой странице с
// картинкой) означает, что реальный контент — это картинка, а не текст,
// даже если несколько символов технически нашлось.
const MIN_TEXT_LENGTH = 40;

function stripDocumentXml(xml) {
  // Переносы на границах абзацев/строк таблицы и явные <w:br/>/<w:tab/> —
  // иначе все слова документа склеятся в одну строку без пробелов между
  // соседними ячейками/абзацами.
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Кусками по 8 КБ — иначе на крупной встроенной картинке (несколько
// мегабайт) String.fromCharCode.apply упадёт по лимиту размера стека
// аргументов, а посимвольная конкатенация в цикле будет заметно медленнее.
function bytesToBase64(bytes) {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const IMAGE_EXT_TO_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

// Возвращает { mode: 'text', text } — если в .docx есть настоящий текст,
// { mode: 'image', base64, mimeType } — если текста почти нет, но найдена
// встроенная картинка (вероятно, вставленный скан), — или бросает ошибку,
// если нет ни того, ни другого.
export async function extractDocxContent(file) {
  if (!globalThis.JSZip) throw new Error('Модуль DOCX не загрузился. Обновите страницу.');
  const zip = await globalThis.JSZip.loadAsync(file);
  const documentXmlFile = zip.file('word/document.xml');
  if (!documentXmlFile) throw new Error('Файл повреждён или не является документом Word (.docx)');
  const xml = await documentXmlFile.async('string');
  const text = stripDocumentXml(xml);
  if (text.length >= MIN_TEXT_LENGTH) return { mode: 'text', text };

  const mediaFiles = Object.values(zip.files).filter(f => !f.dir && /^word\/media\//.test(f.name));
  const candidates = mediaFiles
    .map(f => ({ file: f, ext: (f.name.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase() }))
    .filter(c => IMAGE_EXT_TO_MIME[c.ext]);
  if (!candidates.length) {
    throw new Error('В документе .docx не найдено ни текста, ни поддерживаемого изображения (PNG/JPEG/WebP) для распознавания');
  }
  // Крупнейшая по размеру — почти наверняка сама вставленная страница/скан,
  // а не мелкий логотип/иконка в колонтитуле.
  let best = null;
  let bestSize = -1;
  for (const candidate of candidates) {
    const bytes = await candidate.file.async('uint8array');
    if (bytes.length > bestSize) { bestSize = bytes.length; best = { ...candidate, bytes }; }
  }
  return { mode: 'image', base64: bytesToBase64(best.bytes), mimeType: IMAGE_EXT_TO_MIME[best.ext] };
}
