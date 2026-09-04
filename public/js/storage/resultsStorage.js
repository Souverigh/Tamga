// Сохранение результатов распознавания между визитами (localStorage).
// Не знает ничего про то, как результаты отрисовываются — только хранит/отдаёт данные.

const STORAGE_KEY_RESULTS = 'tamga_last_results';

export function saveResultsToStorage(results) {
  try {
    localStorage.setItem(STORAGE_KEY_RESULTS, JSON.stringify(results));
  } catch (_) { /* например, превышен лимит localStorage — молча пропускаем, это не критично */ }
}

export function loadSavedResults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RESULTS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function clearSavedResults() {
  try { localStorage.removeItem(STORAGE_KEY_RESULTS); } catch (_) { /* ignore */ }
}
