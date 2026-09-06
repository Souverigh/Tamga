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

import { pageImageToBase64 } from '../ocr/imageLoader.js';

const MAX_RETRY_ATTEMPTS = 2; // всего до 3 попыток (исходная + 2 повтора)
const DEFAULT_RETRY_DELAY_MS = 15000; // если Gemini не подсказала точное время ожидания
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
        items: Array.isArray(data.items) && data.items.length ? data.items : null
      };
    }

    // 429/503 — временные состояния на стороне Gemini (см. RETRYABLE_STATUSES выше),
    // предсказуемо проходят после паузы. Остальные статусы (504, 500 и т.д.) отдаём
    // вызывающему коду как есть — там уже есть свой fallback (например, в app.js
    // follow-up просто не роняет страницу целиком, см. recognizePage).
    if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRY_ATTEMPTS) {
      const delayMs = parseRetryDelayMs(data?.error) ?? Math.min(DEFAULT_RETRY_DELAY_MS * (attempt + 1), MAX_RETRY_DELAY_MS);
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
