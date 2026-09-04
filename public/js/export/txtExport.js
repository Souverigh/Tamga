// Экспорт всего распознанного текста. Принимает уже готовые данные
// (массив групп {fileName, docType, text}) — не читает DOM самостоятельно.

export function buildAllText(groups) {
  return groups.map(({ fileName, docType, text }) => {
    return `=== ${fileName} (Тип документа: ${docType}) ===\n${text}`;
  }).join('\n\n\n');
}

export function downloadTxt(groups) {
  const blob = new Blob([buildAllText(groups)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `tamga_${stamp}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
