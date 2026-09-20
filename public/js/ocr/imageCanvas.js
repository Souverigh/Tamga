// Кадр страницы (<img> или canvas) → canvas для Tesseract.js.
//
// Ethan, 20 сен 2026, живой кейс: распознавание JPG/PNG зависало на
// "Распознаём…" без результата, в консоли — net::ERR_FILE_NOT_FOUND для
// blob:-адреса и "e.toBlob is not a function". Причина: loadImageFile()
// (ocr/imageLoader.js) отдаёт <img>, чей blob-URL уже отозван сразу после
// загрузки, а Tesseract.js 2.1.5 принимает такой <img> за canvas/URL, пытается
// заново скачать картинку по мёртвому адресу и падает ВНУТРИ своего кода —
// необработанной ошибкой, из-за которой promise worker.detect()/recognize()
// не завершается никогда. PDF-страницы это не задевало (они и так canvas), поэтому
// поворот страницы (ocr/orientation.js, 19 сен) проверялся только на PDF и не
// на обычных фото. Canvas Tesseract читает сам (toBlob), URL не нужен.
export function pageToCanvas(pageImage, maxSide = Infinity) {
  if (typeof HTMLCanvasElement !== 'undefined' && pageImage instanceof HTMLCanvasElement && !(pageImage.width > maxSide || pageImage.height > maxSide)) {
    return { canvas: pageImage, release() {} };
  }
  const isCanvas = typeof HTMLCanvasElement !== 'undefined' && pageImage instanceof HTMLCanvasElement;
  const width = isCanvas ? pageImage.width : (pageImage.naturalWidth || pageImage.width);
  const height = isCanvas ? pageImage.height : (pageImage.naturalHeight || pageImage.height);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(pageImage, 0, 0, canvas.width, canvas.height);
  return { canvas, release() { canvas.width = 0; canvas.height = 0; } };
}
