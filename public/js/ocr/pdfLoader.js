// Загрузка PDF: рендерит каждую страницу в canvas через pdf.js.
// Не занимается распознаванием текста — только превращает файл в изображения,
// с которыми дальше работают ocr/tesseractClient.js или api/geminiRecognizeClient.js.

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const MAX_PDF_PAGES = 20;

export async function* iteratePdfPages(file, { signal, onPageCount = () => {} } = {}) {
  if (signal?.aborted) return;
  const buf = await file.arrayBuffer();
  if (signal?.aborted) return;
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  let renderTask;
  let destruction;
  const destroy = () => destruction || (destruction = Promise.resolve(loadingTask.destroy()).catch(() => {}));
  const abort = () => { renderTask?.cancel(); void destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await loadingTask.promise;
    if (signal?.aborted) return;
    const maxPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    onPageCount(maxPages);
    for (let i = 1; i <= maxPages && !signal?.aborted; i++) {
      let page, canvas, error;
      try {
        page = await pdf.getPage(i);
        if (signal?.aborted) return;
        const viewport = page.getViewport({ scale: 2 });
        canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        await renderTask.promise;
      } catch (err) {
        error = err;
      } finally {
        renderTask = null;
        page?.cleanup();
      }
      if (error || signal?.aborted) {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        if (signal?.aborted) return;
        yield { pageIndex: i - 1, error };
      } else {
        yield { pageIndex: i - 1, image: canvas };
      }
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    await destroy();
  }
}

// Compatibility helper for callers that explicitly need all pages at once.
export async function loadPdfPages(file) {
  const canvases = [];
  for await (const page of iteratePdfPages(file)) {
    if (page.error) throw page.error;
    canvases.push(page.image);
  }
  return canvases;
}
