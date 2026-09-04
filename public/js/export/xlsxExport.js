// Экспорт извлечённых полей (не всего текста) в Excel через SheetJS.
// Принимает уже готовые данные (массив групп {fileName, docType, fields, items}).
// Табличные типы (накладная/УПД) заполняют fields пустым массивом и items
// товарными строками — для них на листе «Тамга» пойдёт пустая строка-заглушка
// (как раньше для файлов без полей), а сами товары идут на отдельный лист «Товары».

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

  const itemRows = [['Файл', 'Тип документа', 'Наименование', 'Артикул', 'Цена', 'Количество', 'Сумма']];
  groups.forEach(({ fileName, docType, items }) => {
    (items || []).forEach(({ name, id, price, qty, sum }) => {
      itemRows.push([fileName, docType, name || '', id || '', price || '', qty || '', sum || '']);
    });
  });
  if (itemRows.length > 1) {
    const wsItems = XLSX.utils.aoa_to_sheet(itemRows);
    wsItems['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 32 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsItems, 'Товары');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `tamga_${stamp}.xlsx`);
}
