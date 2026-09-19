// Лёгкая предварительная проверка поворота страницы перед основным
// распознаванием — см. lib/orientation.js и api/detect-orientation.js.
// В отличие от recognizeWithGemini (geminiRecognizeClient.js) не списывает
// лимит страниц и не кэшируется — отдельный, гораздо более дешёвый запрос
// (маленькая уменьшенная картинка, ответ — одно целое число).

// 768px достаточно, чтобы понять ориентацию текста на странице — это не
// чтение содержимого, а только определение угла поворота.
const PROBE_MAX_DIMENSION = 768;

function dimensionsOf(pageImage) {
  return pageImage instanceof HTMLCanvasElement
    ? { width: pageImage.width, height: pageImage.height }
    : { width: pageImage.naturalWidth || pageImage.width, height: pageImage.naturalHeight || pageImage.height };
}

function toProbeBase64(pageImage) {
  const { width: naturalWidth, height: naturalHeight } = dimensionsOf(pageImage);
  const scale = Math.min(1, PROBE_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(pageImage, 0, 0, width, height);
  const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
  canvas.width = canvas.height = 0;
  return base64;
}

// Возвращает 0, если что-то пошло не так — сбой этой пробы не должен
// блокировать основное распознавание, просто страница уйдёт как есть.
export async function detectRotation(pageImage, { signal } = {}) {
  let base64;
  try {
    base64 = toProbeBase64(pageImage);
  } catch (_) {
    return 0;
  }
  try {
    const res = await fetch('/api/detect-orientation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mimeType: 'image/jpeg' }),
      signal
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return [90, 180, 270].includes(data.rotation) ? data.rotation : 0;
  } catch (_) {
    return 0;
  }
}

// Возвращает НОВЫЙ canvas, повёрнутый на заданный угол по часовой стрелке
// (0/90/180/270). Исходное изображение не трогает — вызывающий код сам решает,
// когда освободить и оригинал, и результат (см. ocr/pageSource.js:releasePageImage).
export function rotateImage(pageImage, degrees) {
  if (!degrees) return pageImage;
  const { width: naturalWidth, height: naturalHeight } = dimensionsOf(pageImage);
  const swap = degrees === 90 || degrees === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? naturalHeight : naturalWidth;
  canvas.height = swap ? naturalWidth : naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(pageImage, -naturalWidth / 2, -naturalHeight / 2);
  return canvas;
}
