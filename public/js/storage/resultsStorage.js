// Documents remain in application memory only. Purge legacy cross-client storage.
const STORAGE_KEY_RESULTS = 'tamga_last_results';
export function clearSavedResults() {
  try { localStorage.removeItem(STORAGE_KEY_RESULTS); } catch (_) { /* storage disabled */ }
}
clearSavedResults();
export function saveResultsToStorage() { clearSavedResults(); }
export function loadSavedResults() { clearSavedResults(); return null; }
