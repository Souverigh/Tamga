// UI-модуль результатов распознавания: отрисовка редактируемых карточек
// (текст + поля), сворачивание, чтение текущего (уже отредактированного
// пользователем) состояния для экспорта. Не знает, как текст был распознан.

import { DOC_TYPES, isTableType, columnsForType, keysForType } from '../config/docSchema.js';
import { extractFieldsHeuristic } from '../extraction/heuristicExtractor.js';

const resultsPanel = document.getElementById('resultsPanel');
const pageResults = document.getElementById('pageResults');
const toggleCollapseBtn = document.getElementById('toggleCollapseBtn');

let allCollapsed = false;

function renderFieldsTable(container, fields) {
  container.innerHTML = '';
  fields.forEach(({ label, value }) => {
    const row = document.createElement('div');
    row.className = 'fields-row';
    const l = document.createElement('div');
    l.className = 'fields-label';
    l.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fields-input';
    input.value = value || '';
    row.appendChild(l);
    row.appendChild(input);
    container.appendChild(row);
  });
}

// Таблица товарных строк для табличных типов (накладная/УПД, справочник
// номенклатуры и т.д.) — вместо карточки {label, value} это N строк из
// одинаковых колонок (columns/keys свои для каждого типа, см. docSchema.js).
// Строки редактируемые, плюс кнопка «Добавить строку», т.к. Gemini редко
// распознаёт такие таблицы идеально построчно (см. хендовер).
function renderLineItemsRow(container, columns, keys, item) {
  const row = document.createElement('div');
  row.className = 'line-items-row';
  keys.forEach((key, i) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'line-items-input';
    input.dataset.key = key;
    input.placeholder = columns[i];
    input.value = (item && item[key]) || '';
    row.appendChild(input);
  });
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'line-items-remove';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Удалить строку';
  removeBtn.addEventListener('click', () => row.remove());
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function renderLineItemsTable(container, docType, items) {
  container.innerHTML = '';
  const columns = columnsForType(docType);
  const keys = keysForType(docType);

  const header = document.createElement('div');
  header.className = 'line-items-row line-items-header';
  columns.forEach(col => {
    const h = document.createElement('div');
    h.className = 'line-items-header-cell';
    h.textContent = col;
    header.appendChild(h);
  });
  container.appendChild(header);

  const rows = document.createElement('div');
  rows.className = 'line-items-rows';
  container.appendChild(rows);

  (items.length ? items : [null]).forEach(item => renderLineItemsRow(rows, columns, keys, item));

  const addRowBtn = document.createElement('button');
  addRowBtn.type = 'button';
  addRowBtn.className = 'line-items-add-row';
  addRowBtn.textContent = '+ Добавить строку';
  addRowBtn.addEventListener('click', () => renderLineItemsRow(rows, columns, keys, null));
  container.appendChild(addRowBtn);
}

// docType нужен, чтобы знать, какие ключи (keys) относятся к этому типу —
// без этого пустая строка нового типа не отфильтровывалась бы корректно.
function readLineItemsTable(container, docType) {
  const keys = keysForType(docType);
  return Array.from(container.querySelectorAll('.line-items-rows .line-items-row')).map(row => {
    const item = {};
    row.querySelectorAll('.line-items-input').forEach(input => { item[input.dataset.key] = input.value; });
    return item;
  }).filter(item => keys.some(k => (item[k] || '').trim() !== ''));
}

export function renderResultGroup({ fileName, pages, docType, fields, items }) {
  const group = document.createElement('div');
  group.className = 'file-result-group';

  const title = document.createElement('div');
  title.className = 'file-result-title';
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = '▾';
  const titleText = document.createElement('span');
  titleText.className = 'title-text';
  titleText.textContent = fileName;
  title.appendChild(chevron);
  title.appendChild(titleText);
  title.addEventListener('click', () => group.classList.toggle('collapsed'));
  group.appendChild(title);

  const collapsible = document.createElement('div');
  collapsible.className = 'collapsible';
  group.appendChild(collapsible);

  const typeRow = document.createElement('div');
  typeRow.className = 'doc-type-row';
  const typeLabel = document.createElement('span');
  typeLabel.textContent = 'Тип документа: ';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'doc-type-select';
  DOC_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === docType) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeRow.appendChild(typeLabel);
  typeRow.appendChild(typeSelect);
  collapsible.appendChild(typeRow);

  const fieldsTable = document.createElement('div');
  const tableMode = isTableType(docType);
  fieldsTable.className = tableMode ? 'line-items-table' : 'fields-table';
  group.dataset.mode = tableMode ? 'table' : 'fields';
  if (tableMode) {
    renderLineItemsTable(fieldsTable, docType, items || []);
  } else {
    renderFieldsTable(fieldsTable, fields);
  }
  collapsible.appendChild(fieldsTable);

  // Смена типа документа вручную в результатах пересчитывает поля локально —
  // это уже после распознавания, лишний вызов Gemini здесь не нужен. Для табличных
  // типов эвристика недоступна (см. heuristicExtractor.js) — таблица начинается пустой,
  // пользователь заполняет вручную кнопкой «Добавить строку».
  typeSelect.addEventListener('change', () => {
    const newType = typeSelect.value;
    const newTableMode = isTableType(newType);
    group.dataset.mode = newTableMode ? 'table' : 'fields';
    fieldsTable.className = newTableMode ? 'line-items-table' : 'fields-table';
    if (newTableMode) {
      renderLineItemsTable(fieldsTable, newType, []);
    } else {
      const areas = collapsible.querySelectorAll('.page-result textarea');
      const currentText = Array.from(areas).map(a => a.value).join('\n');
      const newFields = extractFieldsHeuristic(currentText, newType);
      renderFieldsTable(fieldsTable, newFields);
    }
  });

  pages.forEach((text, i) => {
    const block = document.createElement('div');
    block.className = 'page-result';

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = pages.length > 1 ? `Страница ${i + 1}` : 'Текст';

    const textarea = document.createElement('textarea');
    textarea.dataset.page = i;
    textarea.value = text || '(текст не распознан на этой странице)';

    block.appendChild(label);
    block.appendChild(textarea);
    collapsible.appendChild(block);
  });

  return group;
}

export function showResults(fileResults) {
  pageResults.innerHTML = '';
  fileResults.forEach(fr => pageResults.appendChild(renderResultGroup(fr)));
  resultsPanel.style.display = fileResults.length ? 'block' : 'none';
  toggleCollapseBtn.textContent = 'Свернуть все';
  allCollapsed = false;
}

export function hideResults() {
  resultsPanel.style.display = 'none';
  pageResults.innerHTML = '';
}

export function initResultsCollapseToggle() {
  toggleCollapseBtn.addEventListener('click', () => {
    allCollapsed = !allCollapsed;
    pageResults.querySelectorAll('.file-result-group').forEach(g => g.classList.toggle('collapsed', allCollapsed));
    toggleCollapseBtn.textContent = allCollapsed ? 'Развернуть все' : 'Свернуть все';
  });
}

// Читает текущее (уже отредактированное пользователем) состояние карточек результатов —
// используется модулями экспорта (export/*.js), которые сами DOM не трогают.
export function getFileGroups() {
  const groups = pageResults.querySelectorAll('.file-result-group');
  return Array.from(groups).map(group => {
    const fileName = group.querySelector('.title-text').textContent;
    const docType = group.querySelector('.doc-type-select').value;
    const areas = group.querySelectorAll('.page-result textarea');
    const text = Array.from(areas).map((a, i) => areas.length > 1 ? `[Страница ${i + 1}]\n${a.value}` : a.value).join('\n\n');
    const tableMode = group.dataset.mode === 'table';
    const fields = tableMode ? [] : Array.from(group.querySelectorAll('.fields-row')).map(row => ({
      label: row.querySelector('.fields-label').textContent,
      value: row.querySelector('.fields-input').value
    }));
    const items = tableMode ? readLineItemsTable(group.querySelector('.line-items-table'), docType) : [];
    return { fileName, docType, text, fields, items };
  });
}
