// Экспорт извлечённых полей (не всего текста) в PDF.
// Принимает уже готовые данные (массив групп {fileName, docType, fields})
// и колбэки для индикации состояния кнопки — сам ничего не знает про DOM кнопки.
//
// Строим офскрин-контейнер с реальным DOM и шрифтом браузера, затем рендерим его
// напрямую через html2canvas в картинку (кириллица корректна, т.к. это реальный
// рендер браузера), и уже картинку нарезаем на страницы PDF вручную — это надёжнее,
// чем встроенный doc.html() jsPDF, который плохо работает с элементами, вынесенными
// за пределы экрана (даёт пустой PDF).

import { columnsForType, keysForType } from '../config/docSchema.js';

// Ширины колонок распределяются поровну — у разных табличных типов разное
// число колонок (накладная — 5, справочник номенклатуры — 6 и т.д.), поэтому
// фиксированные проценты под конкретный набор колонок здесь не подходят.
// columnsOverride/keysOverride (опционально) — реально использованная раскладка
// с сервера (см. results.js:getFileGroups) — нужна при клиентском field_overrides
// для этого типа, иначе отличается от статичной схемы docSchema.js. Раньше эта
// функция всегда брала колонки по имени типа — тихо ломало экспорт при override.
function buildLineItemsTable(docType, items, columnsOverride, keysOverride) {
  const columns = columnsOverride || columnsForType(docType);
  const keys = keysOverride || keysForType(docType);
  const width = `${(100 / columns.length).toFixed(1)}%`;

  const table = document.createElement('table');
  table.style.cssText = 'width:100%; border-collapse:collapse; font-size:10px;';

  const headRow = document.createElement('tr');
  columns.forEach(label => {
    const th = document.createElement('td');
    th.textContent = label;
    th.style.cssText = `padding:3px 6px 3px 0; color:#5B5F52; font-weight:bold; border-bottom:1px solid #C9C2AE; width:${width};`;
    headRow.appendChild(th);
  });
  table.appendChild(headRow);

  items.forEach(item => {
    const tr = document.createElement('tr');
    keys.forEach(key => {
      const td = document.createElement('td');
      td.textContent = item[key] || '—';
      td.style.cssText = 'padding:3px 6px 3px 0; vertical-align:top;';
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  return table;
}

function buildOffscreenContainer(groups) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:0; top:0; z-index:99999; width:520px; padding:24px; font-family:Arial, sans-serif; color:#1E2433; background:#fff;';

  const titleEl = document.createElement('h1');
  titleEl.textContent = 'Тамга — извлечённые данные';
  titleEl.style.cssText = 'font-size:18px; margin:0 0 16px;';
  container.appendChild(titleEl);

  groups.forEach(({ fileName, docType, fields, items, columns, columnKeys }) => {
    const card = document.createElement('div');
    card.style.cssText = 'margin-bottom:22px; padding-bottom:14px; border-bottom:1px solid #C9C2AE;';

    const nameEl = document.createElement('div');
    nameEl.textContent = fileName;
    nameEl.style.cssText = 'font-size:13px; font-weight:bold; margin-bottom:4px;';
    card.appendChild(nameEl);

    const typeEl = document.createElement('div');
    typeEl.textContent = `Тип документа: ${docType}`;
    typeEl.style.cssText = 'font-size:11px; color:#5B5F52; margin-bottom:10px;';
    card.appendChild(typeEl);

    if (items && items.length > 0) {
      card.appendChild(buildLineItemsTable(docType, items, columns, columnKeys));
    } else if (fields.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.textContent = 'Поля не заполнены';
      emptyEl.style.cssText = 'font-size:11px; color:#5B5F52;';
      card.appendChild(emptyEl);
    } else {
      const table = document.createElement('table');
      table.style.cssText = 'width:100%; border-collapse:collapse; font-size:11px;';
      fields.forEach(({ label, value }) => {
        const tr = document.createElement('tr');
        const tdLabel = document.createElement('td');
        tdLabel.textContent = label;
        tdLabel.style.cssText = 'padding:3px 8px 3px 0; color:#5B5F52; vertical-align:top; width:40%;';
        const tdValue = document.createElement('td');
        tdValue.textContent = value || '—';
        tdValue.style.cssText = 'padding:3px 0; vertical-align:top;';
        tr.appendChild(tdLabel);
        tr.appendChild(tdValue);
        table.appendChild(tr);
      });
      card.appendChild(table);
    }

    container.appendChild(card);
  });

  return container;
}

function sliceCanvasToPdf(canvas) {
  const pdfWidth = 595.28; // A4 в pt
  const pdfHeight = 841.89;
  const margin = 30;
  const usableWidth = pdfWidth - margin * 2;
  const usableHeight = pdfHeight - margin * 2;
  const scaleFactor = usableWidth / canvas.width;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const pageCanvasHeightPx = Math.floor(usableHeight / scaleFactor);
  let renderedHeight = 0;
  let first = true;
  while (renderedHeight < canvas.height) {
    const sliceHeightPx = Math.min(pageCanvasHeightPx, canvas.height - renderedHeight);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeightPx;
    sliceCanvas.getContext('2d').drawImage(
      canvas, 0, renderedHeight, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx
    );
    if (!first) doc.addPage();
    doc.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', margin, margin, usableWidth, sliceHeightPx * scaleFactor);
    renderedHeight += sliceHeightPx;
    first = false;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`tamga_${stamp}.pdf`);
}

// onDone(errorOrNull) вызывается по завершении — вызывающий код решает, что делать с кнопкой.
export function downloadPdf(groups, onDone) {
  if (groups.length === 0) return;

  const container = buildOffscreenContainer(groups);
  document.body.appendChild(container);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    html2canvas(container, { scale: 2, backgroundColor: '#ffffff' }).then(canvas => {
      document.body.removeChild(container);
      if (canvas.width === 0 || canvas.height === 0) {
        throw new Error('Не удалось отрисовать содержимое для PDF (пустой холст)');
      }
      sliceCanvasToPdf(canvas);
      onDone(null);
    }).catch(err => {
      if (document.body.contains(container)) document.body.removeChild(container);
      onDone(err);
    });
  }));
}
