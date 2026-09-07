// ZIP-экспорт пачки одним архивом — премиум-функция (Ethan, 7 сен 2026, "ZIP
// всех экспортов пачки", остаток брейнштормленного списка после аналитики/
// confidence по полю/поиска дублей). Клиенту с большой пачкой сейчас нужно
// нажимать 6 отдельных кнопок и сохранять 6 файлов по одному — вместо этого
// один клик даёт один .zip со всеми форматами сразу.
//
// Развилка решена явно (Ethan, 7 сен 2026): в архив идут ВСЕ 6 форматов —
// .txt, Excel, PDF (подетальный), CSV, JSON, сводный отчёт (PDF) — а не
// только "быстрые" текстовые форматы. PDF и сводный отчёт сложнее остальных
// (рендерятся асинхронно через html2canvas, раньше сразу скачивались через
// doc.save()) — оба доработаны отдельно (buildPdfBlob в pdfExport.js,
// buildSummaryBlob в summaryReport.js), чтобы отдавать Blob вместо
// немедленного скачивания.
//
// Использует JSZip (подключён через CDN в index.html, тот же паттерн, что
// SheetJS/html2canvas/jsPDF — "zero npm dependencies", всё через <script>
// в browser-глобале, а не npm install).

import { buildAllText } from './txtExport.js';
import { buildCsv } from './csvExport.js';
import { buildJson } from './jsonExport.js';
import { buildPdfBlob } from './pdfExport.js';
import { buildSummaryBlob } from './summaryReport.js';
import { isTableType, columnsForType, keysForType } from '../config/docSchema.js';
import { maskFields, maskItems } from './sensitiveFields.js';

// Строит Excel workbook и возвращает его как ArrayBuffer (не скачивает файл) —
// логика листов продублирована из xlsxExport.js:downloadXlsx НАМЕРЕННО, а не
// вынесена в общую функцию: там XLSX.writeFile сразу и строит, и скачивает
// книгу одним вызовом SheetJS, разделить их без переписывания downloadXlsx
// (и риска сломать уже работающую отдельную кнопку "Скачать Excel") здесь не
// стоило ради одной функции — SheetJS не даёт способа "построить книгу и
// отдельно решить, скачивать её или нет" проще, чем продублировать сборку.
function buildXlsxArrayBuffer(groups, { maskSensitive = false, branding = null } = {}) {
  function sheetNameFor(docType) {
    return docType.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
  }

  const rows = [];
  if (branding && branding.displayName) {
    rows.push([`${branding.displayName} — извлечённые данные (Тамга)`]);
    rows.push([]);
  }
  rows.push(['Файл', 'Тип документа', 'Поле', 'Значение', 'Уверенность поля (%)']);
  groups.forEach(({ fileName, docType, fields: rawFields, confidence }) => {
    const fields = maskFields(rawFields, maskSensitive);
    if (confidence != null) {
      rows.push([fileName, docType, 'Уверенность модели (%)', confidence, '']);
    }
    if (fields.length === 0) {
      if (confidence == null) rows.push([fileName, docType, '', '', '']);
    } else {
      fields.forEach(({ label, value, confidence: fieldConfidence }) => rows.push([fileName, docType, label, value, fieldConfidence == null ? '' : fieldConfidence]));
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 40 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  if (branding && branding.displayName) {
    wb.Props = { Title: `${branding.displayName} — извлечённые данные`, Company: branding.displayName };
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Тамга');

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

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// onDone(errorOrNull) — тот же контракт, что у downloadPdf/downloadSummaryReport.
// options.maskSensitive/branding — те же, что у остальных export/*.js, применяются
// одинаково ко всем 6 форматов внутри архива.
export function downloadZip(groups, onDone, options = {}) {
  if (groups.length === 0) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const zip = new JSZip();

  zip.file(`tamga_${stamp}.txt`, buildAllText(groups));
  zip.file(`tamga_${stamp}.csv`, '\uFEFF' + buildCsv(groups, options));
  zip.file(`tamga_${stamp}.json`, buildJson(groups, options));
  zip.file(`tamga_${stamp}.xlsx`, buildXlsxArrayBuffer(groups, options));

  // PDF и сводный отчёт — асинхронные (html2canvas), остальные форматы выше
  // строятся синхронно из уже готовых данных браузера. Оба Promise идут
  // параллельно (Promise.all), а не последовательно — рендер каждого не
  // зависит от другого, ждать по очереди только замедлило бы архивацию.
  Promise.all([
    buildPdfBlob(groups, options),
    buildSummaryBlob(groups, options)
  ]).then(([pdfBlob, summaryBlob]) => {
    if (pdfBlob) zip.file(`tamga_${stamp}.pdf`, pdfBlob);
    if (summaryBlob) zip.file(`tamga_svodka_${stamp}.pdf`, summaryBlob);
    return zip.generateAsync({ type: 'blob' });
  }).then(zipBlob => {
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tamga_${stamp}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    onDone(null);
  }).catch(err => onDone(err));
}
