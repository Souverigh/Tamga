// public/admin/accounting/api.js — сетевой слой review-экрана, вынесен из
// accounting.js 15 сен 2026 (модуляризация по просьбе Ethan). Ничего не
// знает про DOM и про public/js/idleSession.js — принимает secret параметром,
// поэтому переиспользуем и тестируем независимо от остальной страницы.

// POST /api/accounting/admin-recognize — распознаёт ОДИН файл. Бросает
// Error с человекочитаемым сообщением при не-2xx ответе (вызывающий код
// просто try/catch, как и раньше).
export async function recognizeDocument(secret, base64, mimeType) {
  const res = await fetch('/api/accounting/admin-recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
    body: JSON.stringify({ image: base64, mimeType })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

// POST /api/accounting/export — принимает МАССИВ уже распознанных
// документов (та же форма, что вернул recognizeDocument, плюс file_name) и
// возвращает Blob с готовым .xlsx. api/accounting/export.js сам решает
// bulk это или один документ — здесь всегда шлём { documents: [...] },
// даже для одного файла, эндпоинт это принимает (см. normalizeDocument там же).
export async function exportDocuments(secret, documents) {
  const res = await fetch('/api/accounting/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
    body: JSON.stringify({ documents })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Ошибка ${res.status}`);
  }
  return res.blob();
}
