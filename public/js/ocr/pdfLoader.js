// Загрузка PDF: рендерит каждую страницу в canvas через pdf.js.
// Не занимается распознаванием текста — только превращает файл в изображения,
// с которыми дальше работают ocr/tesseractClient.js или api/geminiRecognizeClient.js.

import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs';
import { validateFileSize, boundedViewport, withDeadline } from '../utils/fileSafety.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs';

const MAX_PDF_PAGES = 20;

export async function* iteratePdfPages(file, { signal, onPageCount = () => {} } = {}) {
  if (signal?.aborted) return;
  validateFileSize(file);
  const buf = await withDeadline(file.arrayBuffer());
  if (signal?.aborted) return;
  const loadingTask = pdfjsLib.getDocument({ data: buf, isEvalSupported: false, maxImageSize: 40000000, canvasMaxAreaInBytes: 32000000, cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/cmaps/', cMapPacked: true, standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/standard_fonts/', wasmUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/wasm/' });
  let renderTask;
  let destruction;
  const destroy = () => destruction || (destruction = Promise.resolve().then(() => loadingTask.destroy()).catch(() => {}));
  const abort = () => { renderTask?.cancel(); void destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await withDeadline(loadingTask.promise, abort);
    if (signal?.aborted) return;
    const maxPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    onPageCount(maxPages);
    for (let i = 1; i <= maxPages && !signal?.aborted; i++) {
      let page, canvas, error;
      try {
        page = await withDeadline(pdf.getPage(i), abort);
        if (signal?.aborted) return;
        const viewport = page.getViewport(boundedViewport(page.getViewport({ scale: 1 })));
        canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        renderTask = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
        await withDeadline(renderTask.promise, abort);
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
