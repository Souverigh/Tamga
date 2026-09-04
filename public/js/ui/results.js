// UI-модуль результатов распознавания: отрисовка редактируемых карточек
// (текст + поля), сворачивание, чтение текущего (уже отредактированного
// пользователем) состояния для экспорта. Не знает, как текст был распознан.

import { DOC_TYPES } from '../config/docSchema.js';
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

export function renderResultGroup({ fileName, pages, docType, fields }) {
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
  fieldsTable.className = 'fields-table';
  renderFieldsTable(fieldsTable, fields);
  collapsible.appendChild(fieldsTable);

  // Смена типа документа вручную в результатах пересчитывает поля локально (эвристикой) —
  // это уже после распознавания, лишний вызов Gemini здесь не нужен.
  typeSelect.addEventListener('change', () => {
    const areas = collapsible.querySelectorAll('.page-result textarea');
    const currentText = Array.from(areas).map(a => a.value).join('\n');
    const newFields = extractFieldsHeuristic(currentText, typeSelect.value);
    renderFieldsTable(fieldsTable, newFields);
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
    const fieldRows = group.querySelectorAll('.fields-row');
    const fields = Array.from(fieldRows).map(row => ({
      label: row.querySelector('.fields-label').textContent,
      value: row.querySelector('.fields-input').value
    }));
    return { fileName, docType, text, fields };
  });
}
