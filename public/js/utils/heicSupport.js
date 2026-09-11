import { validateFileSize, validateImageFile } from './fileSafety.js';
// Поддержка HEIC/HEIF (Ethan, 8 сен 2026: "битые фотографии" — по факту это
// в основном фото с iPhone в формате HEIC, который браузеры (и наш код через
// new Image()) физически не умеют декодировать — файл абсолютно исправен,
// просто в незнакомом браузеру формате. Раньше это выглядело как "битый
// файл" с общей ошибкой "Не удалось открыть файл".
//
// heic2any — подключается только внутри временного sandbox iframe (тот же принцип "ноль
// npm-зависимостей", что у pdf.js/tesseract.js/xlsx — глобальная переменная
// через <script>, не npm install). Конвертирует HEIC/HEIF в JPEG прямо в
// браузере, дальше файл идёт по уже существующему пути как обычная картинка.
//
// Кэш по ссылке на File (WeakMap) — если один и тот же файл нужно
// сконвертировать дважды (превью в списке файлов + сама обработка при
// распознавании), не гоняем конвертацию повторно. resolvedCache — отдельно
// хранит УЖЕ ГОТОВЫЙ результат синхронно (не Promise) — нужен там, где нельзя
// ждать асинхронно (см. fileList.js:render() — пересчитывает превью каждый
// раз синхронно, а конвертация к этому моменту может уже быть готова).
const conversionCache = new WeakMap(); // File -> Promise<File>
const resolvedCache = new WeakMap(); // File -> File (готовый результат, когда он уже есть)

// mimeType для HEIC часто пустой или generic (application/octet-stream) на
// не-Safari браузерах/Android — только по нему определить нельзя, поэтому
// дополнительно смотрим на расширение файла.
export function isHeic(file) {
  if (!file || file.__group) return false;
  const type = (file.type || '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') return true;
  const name = (file.name || '').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif');
}

// Возвращает Promise<File> — новый File с тем же именем (расширение
// заменено на .jpg) и содержимым в JPEG. Бросает исключение, если
// heic2any не подключился (сеть/CDN) или сам файл оказался не читаемым
// даже для этой библиотеки (тогда сработает обычная showFileOpenError).
export function convertHeicToJpeg(file) {
  if (conversionCache.has(file)) return conversionCache.get(file);

  const promise = (async () => {
    validateFileSize(file);
    await validateHeicDimensions(file);
    const result = await decodeInFrame(file);
    // HEIC-контейнер иногда содержит несколько кадров (Live Photo и т.п.) —
    // heic2any в этом случае вернёт массив, берём первый кадр, остальные не нужны.
    const blob = Array.isArray(result) ? result[0] : result;
    const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg') || 'photo.jpg';
    const converted = new File([blob], newName, { type: 'image/jpeg', lastModified: file.lastModified });
    await validateImageFile(converted);
    resolvedCache.set(file, converted);
    return converted;
  })();

  conversionCache.set(file, promise);
  return promise;
}

// Синхронный доступ к УЖЕ готовому результату конвертации — null, если ещё
// не начиналась/не завершилась. Нужен там, где нельзя ждать Promise (см.
// fileList.js:render() — пересчитывает превью-ссылки синхронно на каждую
// перерисовку списка).
export function getResolvedHeicConversion(file) {
  return resolvedCache.get(file) || null;
}

// Validate ispe metadata in the actual BMFF property container, not arbitrary byte matches.
async function validateHeicDimensions(file) {
  const bytes = await file.arrayBuffer();
  const d = new DataView(bytes);
  const b = new Uint8Array(bytes);
  const typeAt = p => String.fromCharCode(...b.subarray(p, p + 4));
  if (bytes.byteLength < 16 || typeAt(4) !== 'ftyp') throw new Error('Некорректный HEIC');
  let dimensions = 0, pixels = 0, boxes = 0;
  function walk(start, end, depth) {
    if (depth > 6) throw new Error('Слишком сложный HEIC');
    for (let p = start; p < end;) {
      if (++boxes > 4096 || p + 8 > end) throw new Error('Некорректный HEIC');
      const size = d.getUint32(p), kind = typeAt(p + 4);
      if (size < 8 || p + size > end) throw new Error('Неподдерживаемая структура HEIC');
      if (kind === 'ispe') {
        if (size < 20) throw new Error('Некорректные размеры HEIC');
        const w = d.getUint32(p + 12), h = d.getUint32(p + 16);
        pixels += w * h; dimensions++;
        if (!w || !h || w > 16384 || h > 16384 || pixels > 80000000 || dimensions > 64) throw new Error('HEIC превышает лимит декодирования');
      }
      if (['meta', 'iprp', 'ipco'].includes(kind)) walk(p + 8 + (kind === 'meta' ? 4 : 0), p + size, depth + 1);
      p += size;
    }
  }
  walk(0, bytes.byteLength, 0);
  if (!dimensions) throw new Error('Не удалось проверить размеры HEIC');
}
let decodeQueue = Promise.resolve();
function decodeInFrame(file) {
  const work = decodeQueue.then(() => new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = '/heic-decoder.html';
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); };
    const receive = event => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === 'decoded') { cleanup(); resolve(event.data.blob); }
      else if (event.data?.type === 'decode-error') { cleanup(); reject(new Error('Не удалось открыть HEIC')); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Превышено время декодирования HEIC')); }, 30000);
    window.addEventListener('message', receive);
    frame.onload = () => frame.contentWindow.postMessage({ type: 'decode', file }, '*');
    document.body.appendChild(frame);
  }));
  decodeQueue = work.catch(() => {});
  return work;
}
