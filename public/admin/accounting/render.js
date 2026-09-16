// public/admin/accounting/render.js — DOM-рендеринг review-экрана, вынесен
// из accounting.js 15 сен 2026 (модуляризация по просьбе Ethan). Каждая
// функция принимает нужные ей DOM-элементы параметрами, а не берёт их из
// модульных констант — так их можно переиспользовать/тестировать
// независимо от того, как называется id в конкретной html-странице.

import { HEADER_FIELD_LABELS, RULE_LABELS, FILE_STATUS_LABELS, LOW_CONFIDENCE_THRESHOLD } from './labels.js';

// <img> не показывает PDF (это не картинка), а <embed>/<iframe> с PDF на
// мобильном Chrome ненадёжны (часто пусто/плейсхолдер вместо содержимого) —
// поэтому PDF открывается по ссылке в системном просмотрщике/новой вкладке
// через blob:, а не встраивается инлайн. Картинки — как раньше, инлайн.
// previewBlobUrl — состояние модуля (а не переменная вызывающего кода),
// чтобы renderPreview сам чистил за собой предыдущий URL при каждом вызове.
let previewBlobUrl = null;

// Bulk-загрузка (15 сен 2026, §18 хендовера) — список выбранных/
// распознанных файлов со статусом каждого. onSelect(index) вызывается по
// клику на строку — сама навигация (какой документ активен) остаётся у
// вызывающего кода (accounting.js), эта функция только рисует список.
export function renderFileList(fileListEl, docs, activeIndex, onSelect) {
  if (!docs.length) {
    fileListEl.style.display = 'none';
    fileListEl.innerHTML = '';
    return;
  }
  fileListEl.style.display = '';
  fileListEl.innerHTML = '';
  docs.forEach((doc, index) => {
    const row = document.createElement('div');
    row.className = `acct-file-item${index === activeIndex ? ' acct-file-active' : ''}`;
    row.innerHTML = `
      <span class="acct-file-name">${doc.file.name}</span>
      <span class="acct-file-status acct-file-status-${doc.status}">${FILE_STATUS_LABELS[doc.status]}</span>
    `;
    if (doc.error) row.title = doc.error;
    row.addEventListener('click', () => onSelect(index));
    fileListEl.appendChild(row);
  });
}

export function renderPreview(previewBox, mimeType, base64) {
  if (previewBlobUrl) { URL.revokeObjectURL(previewBlobUrl); previewBlobUrl = null; }

  if (mimeType === 'application/pdf') {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    previewBlobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    previewBox.innerHTML = `<a href="${previewBlobUrl}" target="_blank" rel="noopener" class="btn-secondary">Открыть PDF</a>`;
    return;
  }
  previewBox.innerHTML = `<img src="data:${mimeType};base64,${base64}" class="acct-preview" alt="Загруженный документ">`;
}

export function renderHeaderTable(headerTable, header) {
  headerTable.innerHTML = '';
  for (const [key, label] of Object.entries(HEADER_FIELD_LABELS)) {
    const field = header[key];
    if (!field) continue;
    const row = document.createElement('tr');
    const low = field.confidence != null && field.confidence < LOW_CONFIDENCE_THRESHOLD;
    const displayValue = key.endsWith('_date') && /^\d{4}-\d{2}-\d{2}$/.test(field.value)
      ? `${field.value.slice(8, 10)}-${field.value.slice(5, 7)}-${field.value.slice(2, 4)}`
      : field.value;
    row.innerHTML = `
      <td class="acct-field-name">${label}</td>
      <td class="${low ? 'acct-low-confidence' : ''}">${displayValue || '—'}${low ? ` (уверенность ${field.confidence}%)` : ''}</td>
    `;
    headerTable.appendChild(row);
  }
}

// Платёжное поручение (15 сен 2026) не имеет таблицы строк — items всегда
// пустой массив для этого типа (см. lib/accounting/document.js,
// buildPaymentOrderDoc). Прячем секцию "Строки" целиком вместо пустой
// таблицы с заголовками, но без содержимого.
export function renderItemsTable(itemsBody, itemsSection, itemsSectionTitle, items) {
  itemsBody.innerHTML = '';
  const hasItems = Array.isArray(items) && items.length > 0;
  itemsSection.style.display = hasItems ? '' : 'none';
  itemsSectionTitle.style.display = hasItems ? '' : 'none';
  if (!hasItems) return;
  for (const item of items) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td data-label="Наименование">${item.description?.value || '—'}</td>
      <td data-label="Кол-во">${item.quantity?.value || '—'}</td>
      <td data-label="Цена">${item.unit_price?.value || '—'}</td>
      <td data-label="Сумма">${item.amount?.value || '—'}</td>
      <td data-label="Ставка НДС">${item.vat_rate?.value || '—'}</td>
      <td data-label="Сумма НДС">${item.vat_amount?.value || '—'}</td>
    `;
    itemsBody.appendChild(row);
  }
}

// Только не-PASS/не-NOT_APPLICABLE проверки показываем текстом (message) —
// PASS/NOT_APPLICABLE рендерим свёрнуто, ОДИН РАЗ на rule_id (правило может
// вернуть несколько результатов — по одному на поле/строку, — так что без
// dedupe тут был бы 'INV-001, INV-001, INV-001, INV-CONF, INV-CONF, ...',
// см. скриншот Ethan, 14 сен 2026), просто чтобы бухгалтер видел, что
// остальное проверялось и вопросов не вызвало.
export function renderRules(rulesList, results) {
  rulesList.innerHTML = '';
  const passed = results.filter(r => r.status === 'PASS' || r.status === 'NOT_APPLICABLE');
  const rest = results.filter(r => r.status !== 'PASS' && r.status !== 'NOT_APPLICABLE');

  for (const r of rest) {
    const div = document.createElement('div');
    div.className = `acct-rule acct-rule-${r.status}`;
    const label = RULE_LABELS[r.rule_id] || r.rule_id;
    const statusText = {
      FAILED: 'Проверка не пройдена',
      WARNING: 'Требуется проверка',
      INSUFFICIENT_DATA: 'Недостаточно данных для проверки'
    }[r.status] || r.status;
    div.innerHTML = `<span class="acct-rule-id" title="${r.rule_id}">${label}</span><span>${r.message || statusText}</span>`;
    rulesList.appendChild(div);
  }
  const uniquePassedIds = [...new Set(passed.map(r => r.rule_id))];
  if (uniquePassedIds.length) {
    const div = document.createElement('div');
    div.className = 'acct-rule acct-rule-PASS';
    const labels = uniquePassedIds.map(id => RULE_LABELS[id] || id);
    div.textContent = `Пройдено без замечаний (${uniquePassedIds.length}): ${labels.join(', ')}`;
    rulesList.appendChild(div);
  }
}
