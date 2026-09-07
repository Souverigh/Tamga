// Экспорт результатов распознавания в JSON «как есть» — полная структура
// (поля, товарные строки, колонки) для интеграции клиентом в свои системы,
// без потерь по сравнению с CSV/Excel (там табличные типы сведены к плоским
// колонкам). Принимает уже готовые данные (массив групп, см. getFileGroups()
// в ui/results.js) — сам DOM не читает.

export function buildJson(groups) {
  const payload = groups.map(({ fileName, docType, text, fields, items, columns, columnKeys }) => ({
    file: fileName,
    docType,
    text,
    // Пустые/неприменимые для типа поля не включаем — JSON.stringify сам
    // отбрасывает ключи со значением undefined.
    fields: fields && fields.length ? fields : undefined,
    items: items && items.length ? items : undefined,
    columns: columns || undefined,
    columnKeys: columnKeys || undefined
  }));
  return JSON.stringify(payload, null, 2);
}

export function downloadJson(groups) {
  if (groups.length === 0) return;
  const blob = new Blob([buildJson(groups)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `tamga_${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
