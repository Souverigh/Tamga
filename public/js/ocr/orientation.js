// Лёгкая предварительная проверка поворота страницы перед основным
// распознаванием — см. lib/orientation.js и api/detect-orientation.js.
// В отличие от recognizeWithGemini (geminiRecognizeClient.js) не списывает
// лимит страниц и не кэшируется.
//
// Присылаем Gemini готовые варианты (0/90/180/270°) и просим выбрать, какой
// из них уже читается правильно — а не назвать угол числом (см. комментарий
// в lib/orientation.js: сравнение вариантов надёжнее, чем абстрактная оценка
// угла поворота, в которой vision-модели сами по себе нестабильны).

// 768px достаточно, чтобы понять ориентацию текста на странице — это не
// чтение содержимого, а только определение угла поворота.
const PROBE_MAX_DIMENSION = 768;
const ROTATIONS = [0, 90, 180, 270];

function dimensionsOf(pageImage) {
  return pageImage instanceof HTMLCanvasElement
    ? { width: pageImage.width, height: pageImage.height }
    : { width: pageImage.naturalWidth || pageImage.width, height: pageImage.naturalHeight || pageImage.height };
}

function drawScaled(pageImage, targetLong) {
  const { width: naturalWidth, height: naturalHeight } = dimensionsOf(pageImage);
  const scale = Math.min(1, targetLong / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(pageImage, 0, 0, width, height);
  return canvas;
}

// Возвращает НОВЫЙ canvas, повёрнутый на заданный угол по часовой стрелке
// (0/90/180/270). Исходное изображение не трогает.
function rotateCanvas(source, degrees) {
  if (!degrees) return source;
  const { width: sourceWidth, height: sourceHeight } = dimensionsOf(source);
  const swap = degrees === 90 || degrees === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? sourceHeight : sourceWidth;
  canvas.height = swap ? sourceWidth : sourceHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -sourceWidth / 2, -sourceHeight / 2);
  return canvas;
}

function releaseCanvas(canvas) { canvas.width = canvas.height = 0; }

// Возвращает 0, если что-то пошло не так — сбой этой пробы не должен
// блокировать основное распознавание, просто страница уйдёт как есть.
export async function detectRotation(pageImage, { signal } = {}) {
  let probe;
  try {
    probe = drawScaled(pageImage, PROBE_MAX_DIMENSION);
  } catch (_) {
    return 0;
  }
  const images = ROTATIONS.map(degrees => {
    const rotated = rotateCanvas(probe, degrees);
    const base64 = rotated.toDataURL('image/jpeg', 0.7).split(',')[1];
    if (rotated !== probe) releaseCanvas(rotated);
    return { mimeType: 'image/jpeg', base64 };
  });
  releaseCanvas(probe);

  try {
    const res = await fetch('/api/detect-orientation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images }),
      signal
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return ROTATIONS.includes(data.rotation) ? data.rotation : 0;
  } catch (_) {
    return 0;
  }
}

// Возвращает НОВЫЙ canvas, повёрнутый на заданный угол по часовой стрелке
// (0/90/180/270) — версия для полноразмерной страницы перед отправкой на
// распознавание. pageImage остаётся нетронутым — вызывающий код сам решает,
// когда освободить и оригинал, и результат (см. ocr/pageSource.js:releasePageImage).
export function rotateImage(pageImage, degrees) {
  if (!degrees) return pageImage;
  return rotateCanvas(pageImage, degrees);
}
