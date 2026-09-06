// Распознавание через Gemini идёт через собственный бекенд (/api/recognize) —
// ключ Google не хранится и не вводится в браузере, см. api/recognize.js и lib/recognize.js.
// Если presetDocType передан (пользователь выбрал тип вручную), бекенд пропускает
// классификацию и сразу извлекает поля под этот тип — см. lib/recognize.js.
// options.skipOcr — не запрашивать text заново (используется для follow-up
// запроса при авто-детекте табличного типа в app.js: text уже есть с первого
// запроса, повторно запрашивать его — чистая избыточность).
// options.onRetry(info) — вызывается перед каждым повтором после 429, чтобы
// вызывающий код мог показать пользователю, что и почему сейчас ждёт (см. app.js).
// options.signal — AbortSignal: прерывает и сам fetch, и ожидание перед повтором
// (важно при параллельном распознавании нескольких страниц — отмена должна
// остановить каждую из них, а не только ту, что попадёт в проверку между итерациями).
// options.clientSlug — идентификатор клиентского пилота (?client=slug, см.
// branding.js/getClientSlug) — сервер по нему найдёт конфиг клиента в Supabase
// (кастомные поля/типы/форматирование), см. lib/recognize.js. Без него — как раньше.

import { pageImageToBase64 } from '../ocr/imageLoader.js';

const MAX_RETRY_ATTEMPTS = 2; // всего до 3 попыток (исходная + 2 повтора)
// Разные дефолтные задержки по типу ошибки — они принципиально разной природы:
//   429 — исчерпан лимит запросов В МИНУТУ (скользящее окно) — есть смысл ждать
//         долго, окно не освободится раньше, чем через десяток секунд.
//   503 — модель Gemini кратковременно перегружена ("high demand") — это не
//         привязано к минутному окну, обычно проходит за пару секунд; долгая
//         пауза здесь просто зря удлиняет ожидание человека перед экраном
//         (см. живой пример: 6 из ~22 запросов вернули 503 за сессию, каждый
//         с 15-секундной паузой добавлял по 15+ сек к общему времени распознавания
//         даже пачки из 1-2 документов).
const DEFAULT_RETRY_DELAY_MS = { 429: 15000, 503: 2000 };
const FALLBACK_RETRY_DELAY_MS = 15000; // на случай статуса вне карты выше
const MAX_RETRY_DELAY_MS = 60000; // не ждём дольше минуты, даже если Gemini попросит больше

// Статусы, которые имеет смысл повторять автоматически — это временные состояния
// на стороне Gemini, обычно проходят сами после паузы:
//   429 — превышен лимит бесплатного тарифа (в минуту)
//   503 — модель временно перегружена ("currently experiencing high demand")
// До фикса в lib/geminiClient.js сервер всегда отдавал 502 независимо от реального
// статуса Gemini, поэтому проверка по res.status здесь ничего не ловила — теперь
// сервер пробрасывает настоящий код, и оба случая обрабатываются одинаково.
const RETRYABLE_STATUSES = new Set([429, 503]);

// Free-tier 429 от Gemini обычно содержит "...Please retry in 36.536187226s" —
// вытаскиваем эту рекомендацию, чтобы ждать ровно столько, сколько нужно, а не
// гадать интервал самостоятельно.
function parseRetryDelayMs(message) {
  const m = /retry in ([\d.]+)\s*s/i.exec(message || '');
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export async function recognizeWithGemini(pageImage, presetDocType, options) {
  const base64 = pageImageToBase64(pageImage);
  const body = { image: base64, mimeType: 'image/jpeg' };
  if (presetDocType) body.docType = presetDocType;
  if (options && options.skipOcr) body.skipOcr = true;
  if (options && options.clientSlug) body.clientSlug = options.clientSlug;
  const onRetry = options && options.onRetry;
  const signal = options && options.signal;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });

    let data;
    try { data = await res.json(); } catch (_) { data = null; }

    if (res.ok) {
      return {
        text: data.text || '',
        docType: data.documentType || 'Другое',
        fields: Array.isArray(data.fields) && data.fields.length ? data.fields : null,
        items: Array.isArray(data.items) && data.items.length ? data.items : null,
        // Реально использованная раскладка колонок (см. lib/recognize.js) — только
        // при табличном типе. Нужна фронтенду, т.к. при клиентском override она
        // отличается от статичной схемы docSchema.js (см. app.js/results.js/export/*).
        columns: Array.isArray(data.columns) && data.columns.length ? data.columns : null,
        columnKeys: Array.isArray(data.columnKeys) && data.columnKeys.length ? data.columnKeys : null
      };
    }

    // 429/503 — временные состояния на стороне Gemini (см. RETRYABLE_STATUSES выше),
    // предсказуемо проходят после паузы. Остальные статусы (504, 500 и т.д.) отдаём
    // вызывающему коду как есть — там уже есть свой fallback (например, в app.js
    // follow-up просто не роняет страницу целиком, см. recognizePage).
    if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRY_ATTEMPTS) {
      const base = DEFAULT_RETRY_DELAY_MS[res.status] ?? FALLBACK_RETRY_DELAY_MS;
      // Небольшой джиттер (0-400мс) — при параллельном распознавании нескольких
      // страниц несколько запросов часто ловят один и тот же всплеск 503 почти
      // синхронно; без джиттера их повторы тоже стартуют синхронно и могут
      // снова столкнуться с перегрузкой все разом.
      const jitter = Math.floor(Math.random() * 400);
      const delayMs = parseRetryDelayMs(data?.error) ?? Math.min(base * (attempt + 1) + jitter, MAX_RETRY_DELAY_MS);
      if (onRetry) onRetry({ attempt: attempt + 1, maxAttempts: MAX_RETRY_ATTEMPTS, delayMs, status: res.status });
      await sleep(delayMs, signal); // бросит AbortError, если отменили именно во время ожидания повтора
      continue;
    }

    if (res.status === 504) {
      throw new Error('Gemini не успел ответить за отведённое время (504) — попробуйте ещё раз, обычно со второго раза проходит.');
    }
    throw new Error(data?.error || `Сервер распознавания вернул ошибку ${res.status}`);
  }
}
