// Исправление поворота PDF-страниц для модулей "Перевод" и "Бухгалтерия".
//
// Ethan, 19 сен 2026: автоповорот (ocr/orientation.js) уже чинит модуль
// "Распознавание" — там PDF всегда рендерится постранично в JPEG на клиенте
// (см. ocr/pdfLoader.js), и повёрнутый canvas просто попадает в уже готовый
// JPEG. "Перевод" (translationDocs/panel.js) и "Бухгалтерия" (accounting/
// panel.js) устроены иначе: весь PDF-файл целиком (сырые байты, см.
// admin/accounting/fileQueue.js:fileToBase64) уходит в Gemini одним куском,
// без рендера на клиенте — там просто нет canvas, который можно повернуть.
//
// Решение — поправить сам PDF-файл ДО отправки: определить поворот каждой
// страницы через Tesseract OSD (тот же алгоритм и то же разрешение, что и в
// основном модуле, см. boundedViewport в utils/fileSafety.js — на меньшем
// разрешении OSD ошибается, проверено эмпирически), затем выставить PDF-у
// правильный /Rotate через pdf-lib. Это ТОЛЬКО метаданные страницы — сами
// встроенные изображения не перекодируются и не теряют качество, а любой
// нормальный PDF-рендерer (включая внутренний у Gemini) обязан их уважать.
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs';
import { PDFDocument, degrees } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js';
import { boundedViewport } from '../utils/fileSafety.js';
import { detectRotation } from './orientation.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs';

const MAX_PAGES_TO_CHECK = 20; // тот же предел, что MAX_PDF_PAGES в pdfLoader.js

// Возвращает НОВЫЙ File с исправленным /Rotate, если хоть одна страница была
// повёрнута, иначе — тот же файл без изменений (не пересобираем PDF зря).
// Любой сбой (повреждённый файл, недоступный CDN и т.п.) не должен блокировать
// загрузку — при ошибке возвращаем исходный файл как есть, как было раньше.
export async function fixPdfRotation(file) {
  if (file.type !== 'application/pdf') return file;
  try {
    const buffer = await file.arrayBuffer();
    // pdf.js забирает переданный ArrayBuffer себе (detached после отправки в
    // воркер) — передаём ему КОПИЮ (slice(0)), а не сам buffer, иначе
    // PDFDocument.load(buffer) ниже упадёт с "detached ArrayBuffer".
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) });
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, MAX_PAGES_TO_CHECK);
    const rotations = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport(boundedViewport(page.getViewport({ scale: 1 })));
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      rotations.push(await detectRotation(canvas));
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    await loadingTask.destroy();
    if (!rotations.some(Boolean)) return file;

    const pdfDoc = await PDFDocument.load(buffer);
    pdfDoc.getPages().forEach((page, i) => {
      if (!rotations[i]) return;
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + rotations[i]) % 360));
    });
    const fixedBytes = await pdfDoc.save();
    return new File([fixedBytes], file.name, { type: 'application/pdf' });
  } catch (error) {
    console.warn('fixPdfRotation: не удалось проверить/исправить поворот, файл уйдёт как есть', error);
    return file;
  }
}
