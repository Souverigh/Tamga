// Определение поворота страницы перед распознаванием — через Tesseract OSD
// (Orientation and Script Detection), ту же библиотеку, что уже используется
// для офлайн-режима (см. ocr/tesseractClient.js). Работает целиком в браузере,
// без обращения к серверу и без затрат на Gemini.
//
// Ethan, 19 сен 2026: старые сканы/фото документов иногда сфотографированы/
// отсканированы боком. Первые две попытки чинить это через Gemini — просьба
// назвать угол числом, затем сравнение 4 готовых вариантов — обе оказались
// недостаточно надёжны на практике: реальный документ, где Gemini после
// сравнения вариантов всё равно не восстановил распознавание, а после
// РУЧНОГО поворота в правильную сторону — распозналось верно. Vision-модели
// в принципе нестабильны в задачах на пространственное рассуждение.
// Tesseract OSD — не LLM, а отдельный классический алгоритм, обученный
// именно на этот вопрос (анализ формы строк текста, а не "понимание" сцены).
//
// data.orientation_degrees — ГОТОВАЯ величина поворота ПО ЧАСОВОЙ СТРЕЛКЕ,
// которую нужно применить, чтобы текст стал прямым (см. исходники Tesseract,
// osdetect.h: "the values refer to the amount of clockwise rotation to be
// applied to the page for the text to be upright and readable") — инвертировать
// не нужно, ровно это значение и передаём в rotateImage ниже.
import { pageToCanvas } from './imageCanvas.js';
import { withDeadline } from '../utils/fileSafety.js';

const ROTATIONS = [0, 90, 180, 270];
// Тот же предел, что PDF_TARGET_LONG_SIDE в utils/fileSafety.js: на меньшем
// разрешении OSD ошибается (проверено), на большем — лишнее время без выигрыша.
const DETECTION_MAX_SIDE = 2500;
// Проба — вспомогательная: если Tesseract завис/не отвечает (загрузка
// osd.traineddata ~4 МБ по медленной сети, сбой воркера), распознавание не
// должно ждать вечно — уходим без поворота, как при любой другой ошибке пробы.
const DETECTION_TIMEOUT_MS = 60000;

let activeWorker = null;

// Возвращает 0, если распознать не удалось — сбой этой проверки не должен
// блокировать основное распознавание, страница просто уйдёт как есть.
export async function detectRotation(pageImage) {
  const worker = Tesseract.createWorker({ logger: () => {} });
  activeWorker = worker;
  // Tesseract получает canvas, а не <img> (см. ocr/imageCanvas.js: <img> с
  // уже отозванным blob-URL ронял его внутри и promise не завершался никогда).
  let prepared = null;
  try {
    prepared = pageToCanvas(pageImage, DETECTION_MAX_SIDE);
    const detection = (async () => {
      await worker.load();
      await worker.loadLanguage('osd');
      await worker.initialize('osd');
      return worker.detect(prepared.canvas);
    })();
    detection.catch(() => {}); // если сработает таймаут, поздняя ошибка не должна стать необработанной
    const { data } = await withDeadline(detection, () => {}, DETECTION_TIMEOUT_MS);
    if (!ROTATIONS.includes(data?.orientation_degrees)) {
      console.warn('detectRotation: неожиданный ответ OSD, пропускаем поворот', data);
      return 0;
    }
    return data.orientation_degrees;
  } catch (error) {
    // Сбой этой пробы не должен блокировать основное распознавание — но
    // молчать о нём тоже нельзя (иначе "почему поворот не сработал"
    // невозможно отладить без доступа к чужому браузеру, см. историю этого
    // модуля выше — уже трижды меняли подход из-за таких немых сбоев).
    console.warn('detectRotation: проверка поворота не удалась, страница уйдёт как есть', error);
    return 0;
  } finally {
    if (activeWorker === worker) activeWorker = null;
    try { await worker.terminate(); } catch (_) { /* могло уже остановиться */ }
    if (prepared) prepared.release();
  }
}

// Прерывает текущую проверку ориентации (если есть) — тот же приём, что
// cancelTesseract() в tesseractClient.js.
export function cancelDetection() {
  if (activeWorker) {
    const worker = activeWorker;
    activeWorker = null;
    worker.terminate().catch(() => { /* не критично */ });
  }
}

function dimensionsOf(pageImage) {
  return pageImage instanceof HTMLCanvasElement
    ? { width: pageImage.width, height: pageImage.height }
    : { width: pageImage.naturalWidth || pageImage.width, height: pageImage.naturalHeight || pageImage.height };
}

// Возвращает НОВЫЙ canvas, повёрнутый на заданный угол по часовой стрелке
// (0/90/180/270). Исходное изображение не трогает — вызывающий код сам решает,
// когда освободить и оригинал, и результат (см. ocr/pageSource.js:releasePageImage).
export function rotateImage(pageImage, degrees) {
  if (!degrees) return pageImage;
  const { width: sourceWidth, height: sourceHeight } = dimensionsOf(pageImage);
  const swap = degrees === 90 || degrees === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? sourceHeight : sourceWidth;
  canvas.height = swap ? sourceWidth : sourceHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(pageImage, -sourceWidth / 2, -sourceHeight / 2);
  return canvas;
}
