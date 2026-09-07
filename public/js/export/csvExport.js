// Экспорт извлечённых полей и товарных строк в единый плоский CSV.
// В отличие от Excel (xlsxExport.js), у CSV нет вкладок/листов, поэтому
// табличные типы (накладная и т.п.) разворачиваются в те же 5 колонок, что
// и обычные поля (плюс номер строки, чтобы различать товарные позиции) —
// так весь набор результатов помещается в один плоский файл.
// Принимает уже готовые данные (массив групп, см. getFileGroups() в
// ui/results.js) — сам DOM не читает.

import { isTableType, columnsForType, keysForType } from '../config/docSchema.js';

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsvRow(cells) {
  return cells.map(csvEscape).join(',');
}

export function buildCsv(groups) {
  const lines = [toCsvRow(['Файл', 'Тип документа', 'Строка', 'Поле', 'Значение'])];

  groups.forEach(({ fileName, docType, fields, items, columns, columnKeys }) => {
    if (isTableType(docType) && items && items.length) {
      // columns/columnKeys с сервера (клиентский override) имеют приоритет над
      // статичной схемой — та же логика, что в xlsxExport.js.
      const cols = columns || columnsForType(docType);
      const keys = columnKeys || keysForType(docType);
      items.forEach((item, i) => {
        keys.forEach((key, k) => {
          lines.push(toCsvRow([fileName, docType, i + 1, cols[k], item[key] || '']));
        });
      });
    } else if (fields && fields.length) {
      fields.forEach(({ label, value }) => {
        lines.push(toCsvRow([fileName, docType, '', label, value]));
      });
    } else {
      lines.push(toCsvRow([fileName, docType, '', '', '']));
    }
  });

  return lines.join('\r\n');
}

export function downloadCsv(groups) {
  if (groups.length === 0) return;
  // BOM — чтобы Excel на Windows сразу открывал файл в UTF-8 (без BOM кириллица
  // превращается в кракозябры, т.к. Excel по умолчанию читает CSV как ANSI).
  const blob = new Blob(['\uFEFF' + buildCsv(groups)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `tamga_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
