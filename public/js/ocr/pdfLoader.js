// Загрузка PDF: рендерит каждую страницу в canvas через pdf.js.
// Не занимается распознаванием текста — только превращает файл в изображения,
// с которыми дальше работают ocr/tesseractClient.js или api/geminiRecognizeClient.js.

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const MAX_PDF_PAGES = 20;

export async function loadPdfPages(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const maxPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const canvases = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}
