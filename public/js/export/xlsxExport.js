// Экспорт извлечённых полей (не всего текста) в Excel через SheetJS.
// Принимает уже готовые данные (массив групп {fileName, docType, fields}).

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
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `tamga_${stamp}.xlsx`);
}
