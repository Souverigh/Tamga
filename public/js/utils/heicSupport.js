// Поддержка HEIC/HEIF (Ethan, 8 сен 2026: "битые фотографии" — по факту это
// в основном фото с iPhone в формате HEIC, который браузеры (и наш код через
// new Image()) физически не умеют декодировать — файл абсолютно исправен,
// просто в незнакомом браузеру формате. Раньше это выглядело как "битый
// файл" с общей ошибкой "Не удалось открыть файл".
//
// heic2any — подключается через CDN в index.html (тот же принцип "ноль
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
    if (typeof heic2any !== 'function') {
      throw new Error('Библиотека heic2any не загрузилась (проверьте подключение к интернету)');
    }
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    // HEIC-контейнер иногда содержит несколько кадров (Live Photo и т.п.) —
    // heic2any в этом случае вернёт массив, берём первый кадр, остальные не нужны.
    const blob = Array.isArray(result) ? result[0] : result;
    const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg') || 'photo.jpg';
    const converted = new File([blob], newName, { type: 'image/jpeg', lastModified: file.lastModified });
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
