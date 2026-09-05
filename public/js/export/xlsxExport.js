// Экспорт извлечённых полей (не всего текста) в Excel через SheetJS.
// Принимает уже готовые данные (массив групп {fileName, docType, fields, items}).
// Табличные типы заполняют fields пустым массивом и items товарными строками —
// для них на листе «Тамга» пойдёт пустая строка-заглушка (как раньше для файлов
// без полей), а сами товары идут на отдельных листах — по одному листу на
// каждый встретившийся табличный тип, т.к. у разных табличных типов (накладная,
// справочник номенклатуры) разные наборы колонок и их нельзя свести в одну таблицу.

import { isTableType, columnsForType, keysForType } from '../config/docSchema.js';

// Имя листа Excel ограничено 31 символом и не может содержать некоторые символы.
function sheetNameFor(docType) {
  return docType.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

export function downloadXlsx(groups) {
  if (groups.length === 0) return;

  const rows = [['Файл', 'Тип документа', 'Поле', 'Значение']];
  groups.forEach(({ fileName, docType, fields }) => {
    if (fields.length === 0) {
      rows.push([fileName, docType, '', '']);
    } else {
      fields.forEach(({ label, value }) => rows.push([fileName, docType, label, value]));
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Тамга');

  // Группируем товарные строки по типу документа — у каждого табличного типа
  // свои колонки/ключи (см. docSchema.js), поэтому один общий лист не подходит.
  const itemsByType = new Map();
  groups.forEach(({ fileName, docType, items }) => {
    if (!isTableType(docType) || !items || items.length === 0) return;
    if (!itemsByType.has(docType)) itemsByType.set(docType, []);
    itemsByType.get(docType).push(...items.map(item => ({ fileName, item })));
  });

  itemsByType.forEach((entries, docType) => {
    const columns = columnsForType(docType);
    const keys = keysForType(docType);
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
