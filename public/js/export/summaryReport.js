// Сводный отчёт по всей пачке — премиум-функция (Ethan, 7 сен 2026, "давай
// все будем реализовывать потихоньку" — первый пункт из брейнштормленного
// списка после вебхуков/1С). В отличие от остальных export/*.js, которые
// экспортируют ДАННЫЕ каждого документа, этот отчёт — обзор ПО ПАЧКЕ целиком:
// сколько файлов, разбивка по типам, какие требуют проверки. Клиент, сдающий
// пачку в бухгалтерию/юротдел, обычно первым делом смотрит именно на это,
// а не открывает каждый документ по очереди.
//
// Полностью на данных, уже посчитанных в браузере (results.js:getFileGroups —
// confidence и warnings считаются один раз при рендере/смене типа, см. её
// комментарии) — ни новых запросов к серверу, ни изменений в Supabase не
// требуется. Переиспользует общий конвейер рендера PDF из pdfExport.js
// (renderContainerToCanvas/sliceCanvasToPdf) — та же логика "офскрин DOM ->
// html2canvas -> нарезка на страницы", ради которой уже решены проблемы с
// кириллицей и постраничностью.

import { sliceCanvasToPdf, renderContainerToCanvas } from './pdfExport.js';

// Порог "требует проверки" — та же граница 85%, что уже используется для
// жёлтого/зелёного бейджа уверенности в UI (results.js) и в самом pdfExport.js —
// единообразие с уже знакомым клиенту цветовым кодом, а не новое произвольное число.
const LOW_CONFIDENCE_THRESHOLD = 85;

// Чистая функция без DOM — вынесена отдельно ради юнит-тестов (см.
// /tmp/verify/check-summary-report.mjs) и на случай, если понадобится
// показать те же цифры где-то ещё (например, в самом вебхуке пакета).
export function buildSummaryStats(groups) {
  const totalFiles = groups.length;

  const byTypeMap = new Map();
  groups.forEach(({ docType }) => {
    const key = docType || 'Не указан';
    byTypeMap.set(key, (byTypeMap.get(key) || 0) + 1);
  });
  const byType = Array.from(byTypeMap.entries())
    .map(([docType, count]) => ({ docType, count }))
    .sort((a, b) => b.count - a.count);

  const flagged = groups
    .filter(({ confidence, warnings }) =>
      (confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD) || (warnings && warnings.length > 0)
    )
    .map(({ fileName, docType, confidence, warnings }) => ({ fileName, docType, confidence, warnings: warnings || [] }));

  return { totalFiles, byType, flagged };
}

function buildStatsTable(byType) {
  const table = document.createElement('table');
  table.style.cssText = 'width:100%; border-collapse:collapse; font-size:11px; margin-bottom:20px;';
  const headRow = document.createElement('tr');
  ['Тип документа', 'Количество'].forEach(label => {
    const th = document.createElement('td');
    th.textContent = label;
    th.style.cssText = 'padding:4px 8px 4px 0; color:#5B5F52; font-weight:bold; border-bottom:1px solid #C9C2AE;';
    headRow.appendChild(th);
  });
  table.appendChild(headRow);
  byType.forEach(({ docType, count }) => {
    const tr = document.createElement('tr');
    const tdType = document.createElement('td');
    tdType.textContent = docType;
    tdType.style.cssText = 'padding:4px 8px 4px 0; border-bottom:1px solid #EDE9DC;';
    const tdCount = document.createElement('td');
    tdCount.textContent = String(count);
    tdCount.style.cssText = 'padding:4px 0; border-bottom:1px solid #EDE9DC;';
    tr.appendChild(tdType);
    tr.appendChild(tdCount);
    table.appendChild(tr);
  });
  return table;
}

function buildFlaggedTable(flagged) {
  const table = document.createElement('table');
  table.style.cssText = 'width:100%; border-collapse:collapse; font-size:11px;';
  const headRow = document.createElement('tr');
  ['Файл', 'Тип', 'Уверенность', 'Замечания'].forEach(label => {
    const th = document.createElement('td');
    th.textContent = label;
    th.style.cssText = 'padding:4px 8px 4px 0; color:#5B5F52; font-weight:bold; border-bottom:1px solid #C9C2AE;';
    headRow.appendChild(th);
  });
  table.appendChild(headRow);
  flagged.forEach(({ fileName, docType, confidence, warnings }) => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = fileName;
    tdName.style.cssText = 'padding:4px 8px 4px 0; vertical-align:top; border-bottom:1px solid #EDE9DC;';
    const tdType = document.createElement('td');
    tdType.textContent = docType;
    tdType.style.cssText = 'padding:4px 8px 4px 0; vertical-align:top; border-bottom:1px solid #EDE9DC;';
    const tdConf = document.createElement('td');
    tdConf.textContent = confidence == null ? '—' : `${confidence}%`;
    const confColor = confidence == null ? '#5B5F52' : confidence >= 50 ? '#A8630E' : '#C23B2E';
    tdConf.style.cssText = `padding:4px 8px 4px 0; vertical-align:top; color:${confColor}; font-weight:bold; border-bottom:1px solid #EDE9DC;`;
    const tdWarnings = document.createElement('td');
    tdWarnings.textContent = warnings.length ? warnings.map(w => w.message).join(' ') : '—';
    tdWarnings.style.cssText = 'padding:4px 0; vertical-align:top; border-bottom:1px solid #EDE9DC;';
    tr.appendChild(tdName);
    tr.appendChild(tdType);
    tr.appendChild(tdConf);
    tr.appendChild(tdWarnings);
    table.appendChild(tr);
  });
  return table;
}

// branding — { displayName, logoUrl, accentColor } | null, тот же формат,
// что и в pdfExport.js — премиум-клиент видит своё название/лого и на сводке,
// не только на подетальном экспорте.
function buildSummaryContainer(groups, { branding = null } = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:0; top:0; z-index:99999; width:520px; padding:24px; font-family:Arial, sans-serif; color:#1E2433; background:#fff;';

  const accent = (branding && branding.accentColor) || '#1E2433';
  let logoImg = null;

  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:6px;';
  if (branding && branding.logoUrl) {
    logoImg = document.createElement('img');
    logoImg.src = branding.logoUrl;
    logoImg.alt = branding.displayName || 'логотип';
    logoImg.crossOrigin = 'anonymous';
    logoImg.style.cssText = 'width:36px; height:36px; object-fit:contain; border-radius:6px;';
    headerRow.appendChild(logoImg);
  }
  const titleEl = document.createElement('h1');
  titleEl.textContent = branding && branding.displayName ? `${branding.displayName} — сводный отчёт` : 'Тамга — сводный отчёт';
  titleEl.style.cssText = `font-size:18px; margin:0; color:${accent};`;
  headerRow.appendChild(titleEl);
  container.appendChild(headerRow);

  const stamp = new Date();
  const dateEl = document.createElement('div');
  dateEl.textContent = `Сформирован: ${stamp.toLocaleDateString('ru-RU')} ${stamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  dateEl.style.cssText = 'font-size:11px; color:#5B5F52; margin-bottom:18px;';
  container.appendChild(dateEl);

  const { totalFiles, byType, flagged } = buildSummaryStats(groups);

  const totalEl = document.createElement('div');
  totalEl.textContent = `Всего документов: ${totalFiles}`;
  totalEl.style.cssText = 'font-size:13px; font-weight:bold; margin-bottom:10px;';
  container.appendChild(totalEl);

  container.appendChild(buildStatsTable(byType));

  const flaggedTitle = document.createElement('div');
  flaggedTitle.textContent = flagged.length ? `Требуют проверки (${flagged.length})` : 'Требуют проверки';
  flaggedTitle.style.cssText = 'font-size:13px; font-weight:bold; margin-bottom:8px;';
  container.appendChild(flaggedTitle);

  if (flagged.length) {
    container.appendChild(buildFlaggedTable(flagged));
  } else {
    const okEl = document.createElement('div');
    okEl.textContent = 'Нет — все документы распознаны уверенно, замечаний нет.';
    okEl.style.cssText = 'font-size:11px; color:#5B5F52;';
    container.appendChild(okEl);
  }

  return { container, logoImg };
}

// onDone(errorOrNull) — тот же контракт, что у downloadPdf (pdfExport.js).
export function downloadSummaryReport(groups, onDone, options) {
  if (groups.length === 0) return;

  const { container, logoImg } = buildSummaryContainer(groups, options);
  renderContainerToCanvas(container, logoImg).then(canvas => {
    sliceCanvasToPdf(canvas, 'tamga_svodka');
    onDone(null);
  }).catch(err => onDone(err));
}

// Для ZIP-экспорта пачки (см. export/zipExport.js) — тот же рендер, что у
// downloadSummaryReport выше, но возвращает Promise<Blob|null> (null, если
// пачка пуста) вместо прямого скачивания через doc.save().
export function buildSummaryBlob(groups, options) {
  if (groups.length === 0) return Promise.resolve(null);
  const { container, logoImg } = buildSummaryContainer(groups, options);
  return renderContainerToCanvas(container, logoImg)
    .then(canvas => sliceCanvasToPdf(canvas, 'tamga_svodka', { returnBlob: true }));
}
