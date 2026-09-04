// Обёртка над Tesseract.js (офлайн OCR). Не знает про классификацию или
// извлечение полей — только распознаёт текст с картинки и сообщает прогресс.
//
// ВАЖНО: Tesseract.js зафиксирован на v2.1.5 (см. index.html, подключение
// библиотеки) — v4+ требует серверных заголовков COOP/COEP для
// многопоточного WASM-движка, которых нет на статичном хостинге.

export async function recognizeWithTesseract(pageImage, lang, onProgress) {
  const { data } = await Tesseract.recognize(pageImage, lang, {
    logger: m => {
      if (onProgress && m.status && m.progress !== undefined) {
        onProgress({ status: m.status, progress: m.progress });
      }
    }
  });
  return data.text.trim();
}
