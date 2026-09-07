// Экспорт извлечённых полей (не всего текста) в Excel через SheetJS.
// Принимает уже готовые данные (массив групп {fileName, docType, fields, items}).
// Табличные типы заполняют fields пустым массивом и items товарными строками —
// для них на листе «Тамга» пойдёт пустая строка-заглушка (как раньше для файлов
// без полей), а сами товары идут на отдельных листах — по одному листу на
// каждый встретившийся табличный тип, т.к. у разных табличных типов (накладная,
// справочник номенклатуры) разные наборы колонок и их нельзя свести в одну таблицу.

import { isTableType, columnsForType, keysForType } from '../config/docSchema.js';
import { maskFields, maskItems } from './sensitiveFields.js';

// Имя листа Excel ограничено 31 символом и не может содержать некоторые символы.
function sheetNameFor(docType) {
  return docType.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

// options.maskSensitive — см. sensitiveFields.js. options.branding —
// { displayName, logoUrl, accentColor } | null (см. branding.js:getClientBranding).
// SheetJS Community Edition (тот, что подключён через CDN, xlsx.full.min.js)
// не умеет встраивать картинки в лист — это фича только Pro-версии, поэтому
// логотип сюда не идёт (в отличие от PDF), только название клиента текстом.
export function downloadXlsx(groups, { maskSensitive = false, branding = null } = {}) {
  if (groups.length === 0) return;

  const rows = [];
  if (branding && branding.displayName) {
    rows.push([`${branding.displayName} — извлечённые данные (Тамга)`]);
    rows.push([]); // пустая строка-отступ перед таблицей
  }
  rows.push(['Файл', 'Тип документа', 'Поле', 'Значение', 'Уверенность поля (%)']);
  groups.forEach(({ fileName, docType, fields: rawFields, confidence }) => {
    const fields = maskFields(rawFields, maskSensitive);
    // Уверенность на весь документ (см. lib/confidence.js) — та же синтетическая
    // строка-поле, что в csvExport.js, ради согласованности между форматами
    // экспорта. 5-я колонка (про КОНКРЕТНОЕ поле) для этой строки пуста.
    if (confidence != null) {
      rows.push([fileName, docType, 'Уверенность модели (%)', confidence, '']);
    }
    if (fields.length === 0) {
      if (confidence == null) rows.push([fileName, docType, '', '', '']);
    } else {
      // Уверенность на КОНКРЕТНОЕ поле (Ethan, 7 сен 2026, "уверенность по
      // каждому полю") — null (офлайн-режим/старый ответ) -> пустая ячейка.
      fields.forEach(({ label, value, confidence: fieldConfidence }) => rows.push([fileName, docType, label, value, fieldConfidence == null ? '' : fieldConfidence]));
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 40 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  if (branding && branding.displayName) {
    // Свойства документа (File → Сведения в Excel) — дополнительно к видимой
    // строке-заголовку выше, не вместо неё: свойства мало кто открывает.
    wb.Props = { Title: `${branding.displayName} — извлечённые данные`, Company: branding.displayName };
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Тамга');

  // Группируем товарные строки по типу документа — у каждого табличного типа
  // свои колонки/ключи (см. docSchema.js), поэтому один общий лист не подходит.
  // Колонки для группы берутся из ПЕРВОГО файла этой группы — корректно, т.к.
  // override зависит от клиента/сессии (одинаков для всех файлов сессии), не
  // от конкретного файла (см. results.js:getFileGroups — columns/columnKeys
  // приходят с сервера при tableMode, см. lib/recognize.js).
  const itemsByType = new Map();
  groups.forEach(({ fileName, docType, items: rawItems, columns, columnKeys }) => {
    if (!isTableType(docType) || !rawItems || rawItems.length === 0) return;
    const items = maskItems(rawItems, columns || columnsForType(docType), columnKeys || keysForType(docType), maskSensitive);
    if (!itemsByType.has(docType)) itemsByType.set(docType, { columns: columns || null, columnKeys: columnKeys || null, entries: [] });
    itemsByType.get(docType).entries.push(...items.map(item => ({ fileName, item })));
  });

  itemsByType.forEach(({ columns: columnsOverride, columnKeys: keysOverride, entries }, docType) => {
    const columns = columnsOverride || columnsForType(docType);
    const keys = keysOverride || keysForType(docType);
    const itemRows = [['Файл', 'Тип документа', ...columns]];
    entries.forEach(({ fileName, item }) => {
      itemRows.push([fileName, docType, ...keys.map(k => item[k] || '')]);
    });
    const wsItems = XLSX.utils.aoa_to_sheet(itemRows);
    wsItems['!cols'] = [{ wch: 24 }, { wch: 20 }, ...columns.map(() => ({ wch: 18 }))];
    XLSX.utils.book_append_sheet(wb, wsItems, sheetNameFor(docType));
  });

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `tamga_${stamp}.xlsx`);
}
