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
import { maskFields, maskItems } from './sensitiveFields.js';

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

// branding — { displayName, logoUrl, accentColor } | null (см. branding.js:
// getClientBranding) — премиум-опция "брендированный экспорт" (Ethan, 7 сен
// 2026): клиент передаёт PDF дальше со своим лого/названием, а не с "Тамга".
// Возвращает { container, logoImg } — logoImg нужен вызывающему коду
// (downloadPdf), чтобы дождаться его загрузки ПЕРЕД html2canvas: без этого
// картинка почти наверняка не успеет прогрузиться за два requestAnimationFrame
// и просто не попадёт на итоговый PDF (пустой квадрат вместо лого).
function buildOffscreenContainer(groups, { maskSensitive = false, branding = null } = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:0; top:0; z-index:99999; width:520px; padding:24px; font-family:Arial, sans-serif; color:#1E2433; background:#fff;';

  const accent = (branding && branding.accentColor) || '#1E2433';
  let logoImg = null;

  if (branding && branding.logoUrl) {
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:16px;';
    logoImg = document.createElement('img');
    logoImg.src = branding.logoUrl;
    logoImg.alt = branding.displayName || 'логотип';
    // crossOrigin — иначе html2canvas не сможет прочитать пиксели с другого
    // домена (canvas становится "tainted") и либо упадёт, либо отрисует пусто.
    logoImg.crossOrigin = 'anonymous';
    logoImg.style.cssText = 'width:36px; height:36px; object-fit:contain; border-radius:6px;';
    headerRow.appendChild(logoImg);

    const titleEl = document.createElement('h1');
    titleEl.textContent = branding.displayName ? `${branding.displayName} — извлечённые данные` : 'АДРЕ — извлечённые данные';
    titleEl.style.cssText = `font-size:18px; margin:0; color:${accent};`;
    headerRow.appendChild(titleEl);

    container.appendChild(headerRow);
  } else {
    const titleEl = document.createElement('h1');
    titleEl.textContent = branding && branding.displayName ? `${branding.displayName} — извлечённые данные` : 'АДРЕ — извлечённые данные';
    titleEl.style.cssText = `font-size:18px; margin:0 0 16px; color:${accent};`;
    container.appendChild(titleEl);
  }

  groups.forEach(({ fileName, docType, fields: rawFields, items: rawItems, columns, columnKeys, confidence }) => {
    const fields = maskFields(rawFields, maskSensitive);
    const items = maskItems(rawItems, columns || columnsForType(docType), columnKeys || keysForType(docType), maskSensitive);
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

    // Уверенность (см. lib/confidence.js) — цвет по тем же порогам, что бейдж
    // в results.js (85/50), просто на статичном фоне, т.к. PDF рендерится один раз.
    if (confidence != null) {
      const confEl = document.createElement('div');
      confEl.textContent = `Уверенность модели: ${confidence}%`;
      const color = confidence >= 85 ? '#1C8A5C' : confidence >= 50 ? '#A8630E' : '#C23B2E';
      confEl.style.cssText = `font-size:11px; font-weight:bold; color:${color}; margin:-4px 0 10px;`;
      card.appendChild(confEl);
    }

    const hasItemsRows = items && items.length > 0;
    if (hasItemsRows) {
      card.appendChild(buildLineItemsTable(docType, items, columns, columnKeys));
    }
    // fields — карточные поля для обычных типов, а для табличных типов с
    // totals (Ethan, 9 сен 2026, "НДС стоит, но не распознаётся") — блок
    // итогов документа. Отдельная от items ветка (НЕ else if!) — раньше
    // непустая таблица строк полностью скрывала бы итоги ниже неё.
    if (!hasItemsRows && fields.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.textContent = 'Поля не заполнены';
      emptyEl.style.cssText = 'font-size:11px; color:#5B5F52;';
      card.appendChild(emptyEl);
    } else if (fields.length > 0) {
      const table = document.createElement('table');
      table.style.cssText = 'width:100%; border-collapse:collapse; font-size:11px;';
      // Уверенность на КОНКРЕТНОЕ поле (Ethan, 7 сен 2026, "уверенность по
      // каждому полю") — 3-я колонка, тот же цвет по порогам, что и confEl
      // выше (уверенность на документ). Пусто, если её нет (офлайн-режим/
      // старый ответ без неё) — не рисуем "0%" там, где оценки просто не было.
      fields.forEach(({ label, value, confidence: fieldConfidence }) => {
        const tr = document.createElement('tr');
        const tdLabel = document.createElement('td');
        tdLabel.textContent = label;
        tdLabel.style.cssText = 'padding:3px 8px 3px 0; color:#5B5F52; vertical-align:top; width:36%;';
        const tdValue = document.createElement('td');
        tdValue.textContent = value || '—';
        tdValue.style.cssText = 'padding:3px 8px 3px 0; vertical-align:top; width:52%;';
        const tdConfidence = document.createElement('td');
        tdConfidence.style.cssText = 'padding:3px 0; vertical-align:top; text-align:right; font-weight:bold; width:12%;';
        if (fieldConfidence != null) {
          tdConfidence.textContent = `${fieldConfidence}%`;
          tdConfidence.style.color = fieldConfidence >= 85 ? '#1C8A5C' : fieldConfidence >= 50 ? '#A8630E' : '#C23B2E';
        }
        tr.appendChild(tdLabel);
        tr.appendChild(tdValue);
        tr.appendChild(tdConfidence);
        table.appendChild(tr);
      });
      card.appendChild(table);
    }

    container.appendChild(card);
  });

  return { container, logoImg };
}

// Ждёт загрузки лого (успех/ошибка/таймаут) перед тем, как звать html2canvas —
// иначе картинка почти наверняка не успеет прогрузиться за пару кадров и
// просто не попадёт в PDF. Таймаут — на случай недоступного/медленного URL
// логотипа: экспорт не должен зависать навсегда из-за одной картинки, лучше
// отдать PDF без лого, чем не отдать вообще ничего.
export function waitForImage(img, timeoutMs = 4000) {
  if (!img) return Promise.resolve();
  if (img.complete) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => resolve();
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

// Общий конвейер "офскрин-контейнер -> ждать лого -> html2canvas -> canvas,
// с очисткой контейнера в любом исходе" — раньше был продублирован здесь и в
// summaryReport.js (два отдельных .then()-цепочки с одинаковой структурой).
// Вынесен отдельно ради ZIP-экспорта пачки (Ethan, 7 сен 2026, "ZIP-экспорт
// пачки" — см. export/zipExport.js): и подетальный PDF, и сводный отчёт
// нужно уметь рендерить БЕЗ немедленного скачивания, чтобы положить оба в
// архив, а без общего хелпера пришлось бы дублировать эту логику трижды.
export function renderContainerToCanvas(container, logoImg) {
  document.body.appendChild(container);
  return waitForImage(logoImg)
    .then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    .then(() => html2canvas(container, { scale: 2, backgroundColor: '#ffffff', useCORS: true }))
    .then(canvas => {
      document.body.removeChild(container);
      if (canvas.width === 0 || canvas.height === 0) {
        throw new Error('Не удалось отрисовать содержимое (пустой холст)');
      }
      return canvas;
    })
    .catch(err => {
      if (document.body.contains(container)) document.body.removeChild(container);
      throw err;
    });
}

// filenamePrefix — вынесен параметром (Ethan, 7 сен 2026, сводный отчёт по
// пачке, см. export/summaryReport.js), чтобы переиспользовать этот же конвейер
// нарезки canvas->PDF без дублирования — раньше имя файла было зашито здесь.
// options.returnBlob (Ethan, 7 сен 2026, ZIP-экспорт пачки) — вернуть готовый
// PDF как Blob (doc.output('blob')) вместо скачивания через doc.save():
// нужно, чтобы положить PDF в архив вместе с остальными форматами вместо
// того, чтобы браузер тут же скачал его отдельным файлом.
export function sliceCanvasToPdf(canvas, filenamePrefix = 'adre', { returnBlob = false } = {}) {
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

  if (returnBlob) return doc.output('blob');

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`${filenamePrefix}_${stamp}.pdf`);
}

// onDone(errorOrNull) вызывается по завершении — вызывающий код решает, что делать с кнопкой.
// options.maskSensitive — см. sensitiveFields.js. options.branding — см.
// buildOffscreenContainer выше.
export function downloadPdf(groups, onDone, options) {
  if (groups.length === 0) return;

  const { container, logoImg } = buildOffscreenContainer(groups, options);
  renderContainerToCanvas(container, logoImg).then(canvas => {
    sliceCanvasToPdf(canvas);
    onDone(null);
  }).catch(err => onDone(err));
}

// Для ZIP-экспорта пачки (см. export/zipExport.js) — тот же рендер, что у
// downloadPdf выше, но возвращает Promise<Blob|null> (null, если пачка
// пуста) вместо прямого скачивания через doc.save().
export function buildPdfBlob(groups, options) {
  if (groups.length === 0) return Promise.resolve(null);
  const { container, logoImg } = buildOffscreenContainer(groups, options);
  return renderContainerToCanvas(container, logoImg)
    .then(canvas => sliceCanvasToPdf(canvas, 'adre', { returnBlob: true }));
}
