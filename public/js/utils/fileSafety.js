export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_BATCH_BYTES = 100 * 1024 * 1024;
export function validateFileSize(file) {
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('Размер файла должен быть от 1 байта до 20 МиБ');
}
// Целевая сторона рендера PDF-страницы — та же величина, что GEMINI_MAX_DIMENSION
// в imageLoader.js (обычные фото/скан-загрузки уже идут в Gemini с этим
// пределом по длинной стороне). Раньше здесь стоял флажок Math.min(2, ...) —
// для страницы стандартного размера (A4/Letter, ~595-612×792-842pt в единицах
// PDF) это давало scale ровно 2, то есть ~144 "DPI"-эквивалент. Для страницы
// с векторным текстом это ещё туда-сюда читается, а вот для встроенного в PDF
// скана/фотографии (не текста) — заметно хуже, чем то же самое изображение,
// загруженное отдельным файлом JPG/PNG (Ethan, 19 сен 2026: "фотография
// внутри PDF очень плохо читается"). Подняли цель до 2500px по длинной
// стороне — то же самое разрешение, что уже проверено на фото и не упирается
// в таймаут serverless-функции recognize (см. GEMINI_MAX_DIMENSION выше:
// pageImageToBase64 всё равно не пропустит картинку крупнее этого предела,
// так что раздувание запроса к Gemini сверх уже проверенного объёма здесь
// невозможно). Плоский предел 4 — подстраховка от чрезмерного апскейла
// нетипично маленьких страниц (например, PDF с одной квитанцией/этикеткой
// небольшого физического размера), где 2500/сторона иначе дал бы 10-20x.
// 4096px по стороне и 8 000 000 px совокупно остаются как и были — жёсткий
// предел на размер canvas (безопасность памяти на слабом устройстве/телефоне).
const PDF_TARGET_LONG_SIDE = 2500;
export function boundedViewport({ width, height }) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Некорректные размеры страницы');
  return { scale: Math.min(4, PDF_TARGET_LONG_SIDE / Math.max(width, height), 4096 / width, 4096 / height, Math.sqrt(8000000 / width / height)) };
}
export async function withDeadline(promise, cancel = () => {}, ms = 30000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { try { cancel(); } catch (_) { /* cancellation is best effort */ } reject(new Error('Превышено время обработки файла')); }, ms);
    })]);
  } finally { clearTimeout(timer); }
}

// Check dimensions in compressed headers before handing data to an image decoder.
export async function validateImageFile(file) {
  validateFileSize(file);
  const b = new Uint8Array(await file.arrayBuffer());
  const d = new DataView(b.buffer);
  const ascii = (offset, count) => String.fromCharCode(...b.subarray(offset, offset + count));
  let width, height;
  if (b.length >= 33 && ascii(1, 3) === 'PNG' && d.getUint32(0) === 0x89504e47 && d.getUint32(4) === 0x0d0a1a0a) {
    width = d.getUint32(16); height = d.getUint32(20);
  } else if (b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i++] !== 255) break;
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 0xda || marker === 0xd9) break;
      const size = d.getUint16(i);
      if (size < 2 || i + size > b.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && size >= 8) {
        height = d.getUint16(i + 3); width = d.getUint16(i + 5); break;
      }
      i += size;
    }
  } else if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') {
      if (b[20] & 2) throw new Error('Анимированные изображения не поддерживаются');
      width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
      height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    } else if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) {
      width = d.getUint16(26, true) & 16383; height = d.getUint16(28, true) & 16383;
    } else if (kind === 'VP8L' && b[20] === 0x2f) {
      width = 1 + b[21] + ((b[22] & 63) << 8);
      height = 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 15) << 10);
    }
  }
  if (!width || !height || width > 16384 || height > 16384 || width * height > 40000000) throw new Error('Изображение повреждено или превышает лимит 40 мегапикселей');
  return { width, height };
}

const thumbnails = new WeakMap();
export function getSmallPreview(file) { return thumbnails.get(file) || ''; }
export async function prepareSmallPreview(file) {
  await validateImageFile(file);
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    const cleanup = () => { clearTimeout(timer); img.onload = img.onerror = null; img.src = ''; URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Превышено время подготовки превью')); }, 30000);
    img.onerror = () => { cleanup(); reject(new Error('Не удалось открыть изображение')); };
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        thumbnails.set(file, canvas.toDataURL('image/jpeg', 0.7));
        canvas.width = canvas.height = 0;
        cleanup(); resolve();
      } catch (error) { cleanup(); reject(error); }
    };
    img.src = url;
  });
}
