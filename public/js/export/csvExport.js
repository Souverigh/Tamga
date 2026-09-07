// Экспорт извлечённых полей и товарных строк в единый плоский CSV.
// В отличие от Excel (xlsxExport.js), у CSV нет вкладок/листов, поэтому
// табличные типы (накладная и т.п.) разворачиваются в те же 5 колонок, что
// и обычные поля (плюс номер строки, чтобы различать товарные позиции) —
// так весь набор результатов помещается в один плоский файл.
// Принимает уже готовые данные (массив групп, см. getFileGroups() в
// ui/results.js) — сам DOM не читает.

import { isTableType, columnsForType, keysForType } from '../config/docSchema.js';
import { maskFields, maskItems } from './sensitiveFields.js';

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsvRow(cells) {
  return cells.map(csvEscape).join(',');
}

// options.maskSensitive — см. sensitiveFields.js: маскирует ПИН/ИНН, серию и
// номер и т.п. точками, оставляя последние 4 символа видимыми. По умолчанию
// выключено (false) — не меняет поведение существующих вызовов без options.
export function buildCsv(groups, { maskSensitive = false } = {}) {
  const lines = [toCsvRow(['Файл', 'Тип документа', 'Строка', 'Поле', 'Значение', 'Уверенность поля (%)'])];

  groups.forEach(({ fileName, docType, fields: rawFields, items: rawItems, columns, columnKeys, confidence }) => {
    const fields = maskFields(rawFields, maskSensitive);
    const items = maskItems(rawItems, columns || columnsForType(docType), columnKeys || keysForType(docType), maskSensitive);
    // Уверенность на весь документ (см. lib/confidence.js) добавлена синтетической
    // строкой-полем, а не отдельной колонкой — у плоского CSV и так только 5
    // колонок общих на все типы, отдельная колонка только под одно значение
    // раздула бы файл пустыми ячейками на каждой строке. null (нет оценки —
    // офлайн-режим, либо Gemini не смогла её дать) — строку просто не добавляем.
    // Колонку "Уверенность поля (%)" для ЭТОЙ синтетической строки оставляем
    // пустой — она про конкретные поля ниже, не про саму эту строку-метку.
    if (confidence != null) {
      lines.push(toCsvRow([fileName, docType, '', 'Уверенность модели (%)', confidence, '']));
    }
    if (isTableType(docType) && items && items.length) {
      // columns/columnKeys с сервера (клиентский override) имеют приоритет над
      // статичной схемой — та же логика, что в xlsxExport.js. Уверенность по
      // ячейке не запрашивается для табличных типов (см. lib/extraction.js —
      // скоуп фичи), колонка остаётся пустой для этих строк.
      const cols = columns || columnsForType(docType);
      const keys = columnKeys || keysForType(docType);
      items.forEach((item, i) => {
        keys.forEach((key, k) => {
          lines.push(toCsvRow([fileName, docType, i + 1, cols[k], item[key] || '', '']));
        });
      });
    } else if (fields && fields.length) {
      // Уверенность на КОНКРЕТНОЕ поле (Ethan, 7 сен 2026, "уверенность по
      // каждому полю") — только карточные типы (мы уже внутри ветки не-table),
      // null (офлайн-режим/старый ответ без этого поля) — ячейка пустая.
      fields.forEach(({ label, value, confidence: fieldConfidence }) => {
        lines.push(toCsvRow([fileName, docType, '', label, value, fieldConfidence == null ? '' : fieldConfidence]));
      });
    } else if (confidence == null) {
      // Пустая строка-заглушка только если вообще нечего написать про файл —
      // если confidence уже был написан выше, файл и так представлен в выводе.
      lines.push(toCsvRow([fileName, docType, '', '', '', '']));
    }
  });

  return lines.join('\r\n');
}

export function downloadCsv(groups, options) {
  if (groups.length === 0) return;
  // BOM — чтобы Excel на Windows сразу открывал файл в UTF-8 (без BOM кириллица
  // превращается в кракозябры, т.к. Excel по умолчанию читает CSV как ANSI).
  const blob = new Blob(['\uFEFF' + buildCsv(groups, options)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `tamga_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
