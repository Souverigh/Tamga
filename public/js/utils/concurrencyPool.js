// Запускает задачи из items с ограничением на число одновременных (limit),
// вместо строго последовательного выполнения одна-за-другой. Не привязан
// к распознаванию — общий примитив.
//
// isCancelled — необязательный колбэк; если начинает возвращать true, пул
// просто перестаёт брать новые задачи из очереди. Уже запущенные задачи
// не прерываются здесь — если нужна остановка запроса, который уже летит
// (а не только «не начинать следующие»), это ответственность самой задачи
// (см. AbortSignal в geminiRecognizeClient.js).
export async function runWithConcurrency(items, limit, worker, isCancelled) {
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      if (isCancelled && isCancelled()) return;
      const current = items[nextIndex++];
      await worker(current);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, runOne));
}

// Pull pages lazily: at most limit active tasks plus one prepared page.
// Always drain workers before returning, including source/worker failures.
export async function runStreamWithConcurrency(source, limit, worker, isCancelled = () => false, dispose = () => {}) {
  const active = new Set();
  const capacity = Math.max(1, Math.floor(limit) || 1);
  let failed = false;
  let failure;
  try {
    for await (const item of source) {
      while (active.size >= capacity && !isCancelled() && !failed) {
        await Promise.race(active);
      }
      if (isCancelled() || failed) {
        dispose(item);
        break;
      }
      const task = Promise.resolve().then(() => worker(item)).catch(error => {
        failed = true;
        failure = error;
      }).finally(() => active.delete(task));
      active.add(task);
    }
  } finally {
    await Promise.all(active);
  }
  if (failed) throw failure;
}
