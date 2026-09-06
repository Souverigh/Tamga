// Ограничивает ТЕМП вызовов (сколько в скользящем окне времени), а не только
// число одновременных — это разные вещи. Пул параллелизма (concurrencyPool.js)
// не защищает от превышения лимита в минуту сам по себе: 3 одновременных
// запроса, запущенных почти синхронно, на пачке из десятков документов легко
// упираются в 20 запросов/мин Gemini почти сразу, и тогда ретраи (см.
// geminiRecognizeClient.js) сами создают новую волну одновременных повторов —
// вместо ускорения получается всплеск ошибок 429 на самом старте пакета.
//
// acquire() ждёт, пока в окне windowMs не наберётся свободное место, и только
// потом отдаёт разрешение — так суммарный темp запросов держится под лимитом
// независимо от того, сколько workers пула распознавания работает одновременно.
export function createRateLimiter(maxPerWindow, windowMs) {
  const timestamps = [];

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

  return {
    async acquire(signal) {
      for (;;) {
        const now = Date.now();
        while (timestamps.length && now - timestamps[0] >= windowMs) timestamps.shift();
        if (timestamps.length < maxPerWindow) {
          timestamps.push(now);
          return;
        }
        // Ждём, пока самый старый запрос в окне не "устареет" — плюс небольшой
        // запас (50мс), чтобы не попасть в ту же миллисекунду границы окна.
        await sleep(windowMs - (now - timestamps[0]) + 50, signal);
      }
    }
  };
}
