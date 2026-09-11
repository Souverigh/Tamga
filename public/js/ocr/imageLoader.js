// Загрузка обычных изображений (JPG/PNG/HEIC) и преобразование кадра (Image
// или Canvas) в base64. Не знает про PDF; про то, какой движок распознавания
// будет использован дальше — тоже не знает.

import { validateImageFile } from '../utils/fileSafety.js';
import { isHeic, convertHeicToJpeg } from '../utils/heicSupport.js';

export async function loadImageFile(file) {
  // HEIC/HEIF (в основном фото с iPhone) браузер декодировать не умеет —
  // new Image() ниже упал бы с общей ошибкой "файл повреждён", хотя файл
  // совершенно исправен, просто в незнакомом браузеру формате (Ethan, 8 сен
  // 2026). Конвертируем в JPEG заранее — дальше всё остальное работает как
  // с обычной картинкой, без изменений.
  const actualFile = isHeic(file) ? await convertHeicToJpeg(file) : file;
  await validateImageFile(actualFile);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(actualFile);
    const timer = setTimeout(() => { img.src = ''; URL.revokeObjectURL(url); reject(new Error('Превышено время загрузки изображения')); }, 30000);
    img.onload = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve([img]); };
    img.onerror = error => { clearTimeout(timer); URL.revokeObjectURL(url); reject(error); };
    img.src = url;
  });
}

// Фото с телефона часто 3000-4000px по длинной стороне — для OCR текста такое
// разрешение избыточно, а для Gemini это лишние мегабайты в запросе, из-за которых
// распознавание накладных с крупными фото упиралось в таймаут serverless-функции
// (504, см. vercel.json maxDuration). Ограничиваем длинную сторону и переходим на
// JPEG вместо PNG — размер запроса падает в разы, текст остаётся читаемым.
const GEMINI_MAX_DIMENSION = 1800;

export function pageImageToBase64(pageImage) {
  const naturalWidth = pageImage instanceof HTMLCanvasElement ? pageImage.width : (pageImage.naturalWidth || pageImage.width);
  const naturalHeight = pageImage instanceof HTMLCanvasElement ? pageImage.height : (pageImage.naturalHeight || pageImage.height);

  const scale = Math.min(1, GEMINI_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(pageImage, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}
