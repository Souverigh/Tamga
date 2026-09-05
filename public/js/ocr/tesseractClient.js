// Обёртка над Tesseract.js (офлайн OCR). Не знает про классификацию или
// извлечение полей — только распознаёт текст с картинки и сообщает прогресс.
//
// ВАЖНО: Tesseract.js зафиксирован на v2.1.5 (см. index.html, подключение
// библиотеки) — v4+ требует серверных заголовков COOP/COEP для
// многопоточного WASM-движка, которых нет на статичном хостинге.
//
// Используем createWorker() вручную (а не Tesseract.recognize()), чтобы
// держать ссылку на активный воркер — это единственный способ прервать
// распознавание, которое уже идёт: Tesseract.recognize() не принимает
// AbortSignal и никак не отменяется снаружи, только через worker.terminate().

let activeWorker = null;

export async function recognizeWithTesseract(pageImage, lang, onProgress) {
  const worker = Tesseract.createWorker({
    logger: m => {
      if (onProgress && m.status && m.progress !== undefined) {
        onProgress({ status: m.status, progress: m.progress });
      }
    }
  });
  activeWorker = worker;
  try {
    await worker.load();
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
    const { data } = await worker.recognize(pageImage);
    return data.text.trim();
  } finally {
    if (activeWorker === worker) activeWorker = null;
    try { await worker.terminate(); } catch (_) { /* уже остановлен через cancelTesseract() — это нормально */ }
  }
}

// Прерывает текущее распознавание (если есть) — вызывается по кнопке «Отменить».
// worker.terminate() убивает воркер немедленно, ожидающий recognize() отклоняется
// с ошибкой — она долетает до вызывающего кода как обычная ошибка страницы.
export function cancelTesseract() {
  if (activeWorker) {
    const worker = activeWorker;
    activeWorker = null;
    worker.terminate().catch(() => { /* воркер уже мог начать останавливаться сам — не критично */ });
  }
}
