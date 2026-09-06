// UI-модуль списка загруженных файлов до распознавания.
// Отвечает только за: приём файлов, отрисовку строк с миниатюрой/типом/удалением,
// хранение состояния (какие файлы выбраны, какой тип документа проставлен на каждый).
// Не знает ничего про распознавание, прогресс или результаты — сообщает об изменениях
// через колбэк onChange, который настраивает вызывающий код (app.js).

import { DOC_TYPES } from '../config/docSchema.js';
import { getClientSlug } from '../branding.js';

const MAX_FILES = 50;
// Для анонимного бесплатного сайта (без ?client=slug) — пачка меньше, чем для
// настроенных клиентов. Это НЕ единственная защита (её легко обойти прямым
// вызовом /api/recognize в обход интерфейса) — настоящий барьер это дневной
// лимit по IP на сервере (см. lib/anonymousUsage.js). Здесь это просто честная
// подсказка в интерфейсе: если нужны реальные объёмы — нужен платный пакет,
// а не попытка незаметно засунуть туда же 50 файлов с бесплатного сайта.
const FREE_MAX_FILES = 5;

let selectedFiles = []; // File[]
let selectedDocTypes = []; // string[], параллельно selectedFiles — 'auto' или значение из DOC_TYPES/extraDocTypes
let previewUrls = []; // string[], object URL на каждый файл — для просмотра/скачивания оригинала
let onChange = () => {};
// Кастомные типы документов текущего клиентского пилота (см. branding.js,
// tamga_api_key_fields.custom_doc_types) — подгружаются асинхронно, поэтому
// могут появиться уже после того, как человек начал добавлять файлы.
let extraDocTypes = [];

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const cameraInput = document.getElementById('cameraInput');
const fileList = document.getElementById('fileList');
const fileCountLabel = document.getElementById('fileCountLabel');
const fileListItems = document.getElementById('fileListItems');
const clearAllBtn = document.getElementById('clearAllBtn');
const manualTypeToggle = document.getElementById('manualTypeToggle');
const actionRow = document.getElementById('actionRow');
const recognizeBtn = document.getElementById('recognizeBtn');

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' КБ';
  return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
}

function addFiles(fileListObj) {
  const incoming = Array.from(fileListObj);
  let combined = selectedFiles.concat(incoming);
  let combinedTypes = selectedDocTypes.concat(incoming.map(() => 'auto'));
  let truncated = false;
  const effectiveMax = getClientSlug() ? MAX_FILES : FREE_MAX_FILES;
  if (combined.length > effectiveMax) {
    combined = combined.slice(0, effectiveMax);
    combinedTypes = combinedTypes.slice(0, effectiveMax);
    truncated = true;
  }
  selectedFiles = combined;
  selectedDocTypes = combinedTypes;
  render(truncated);
}

function buildFileRow(file, idx) {
  const row = document.createElement('div');
  row.className = 'file-row';

  const thumb = document.createElement('a');
  thumb.className = 'file-thumb';
  thumb.href = previewUrls[idx];
  thumb.target = '_blank';
  thumb.rel = 'noopener';
  thumb.title = 'Открыть оригинал в новой вкладке';
  if (file.type === 'application/pdf') {
    thumb.classList.add('file-thumb-pdf');
    thumb.textContent = 'PDF';
  } else {
    const img = document.createElement('img');
    img.src = previewUrls[idx];
    img.alt = '';
    thumb.appendChild(img);
  }
  row.appendChild(thumb);

  const info = document.createElement('div');
  info.className = 'file-row-main';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = file.name;
  name.title = `${file.name} (${formatSize(file.size)})`; // полное имя и размер — по наведению/долгому нажатию
  info.appendChild(name);
  row.appendChild(info);

  const controls = document.createElement('div');
  controls.className = 'file-row-controls';

  const downloadFileBtn = document.createElement('a');
  downloadFileBtn.className = 'file-download';
  downloadFileBtn.href = previewUrls[idx];
  downloadFileBtn.download = file.name;
  downloadFileBtn.title = 'Скачать оригинал файла';
  downloadFileBtn.textContent = '⬇';
  controls.appendChild(downloadFileBtn);

  const typeSelect = document.createElement('select');
  typeSelect.className = 'file-type-select';
  const autoOpt = document.createElement('option');
  autoOpt.value = 'auto';
  autoOpt.textContent = 'Определить автоматически';
  typeSelect.appendChild(autoOpt);
  DOC_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    typeSelect.appendChild(opt);
  });
  if (extraDocTypes.length) {
    const group = document.createElement('optgroup');
    group.label = 'Ваши типы';
    extraDocTypes.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      group.appendChild(opt);
    });
    typeSelect.appendChild(group);
  }
  typeSelect.value = selectedDocTypes[idx] || 'auto';
  typeSelect.classList.toggle('is-set', typeSelect.value !== 'auto');
  typeSelect.addEventListener('change', () => {
    selectedDocTypes[idx] = typeSelect.value;
    typeSelect.classList.toggle('is-set', typeSelect.value !== 'auto');
  });
  controls.appendChild(typeSelect);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-file';
  removeBtn.textContent = '×';
  removeBtn.title = 'Убрать этот файл';
  removeBtn.addEventListener('click', () => {
    if (recognizeBtn.disabled) return; // идёт распознавание
    selectedFiles.splice(idx, 1);
    selectedDocTypes.splice(idx, 1);
    render(false);
  });
  controls.appendChild(removeBtn);

  row.appendChild(controls);
  return row;
}

function render(truncated) {
  previewUrls.forEach(u => { if (u) URL.revokeObjectURL(u); }); // освобождаем память от предыдущего рендера
  previewUrls = selectedFiles.map(f => URL.createObjectURL(f));

  if (selectedFiles.length === 0) {
    fileList.style.display = 'none';
    actionRow.style.display = 'none';
    document.body.classList.remove('has-action-bar');
    onChange();
    return;
  }

  fileList.style.display = 'block';
  actionRow.style.display = 'flex';
  document.body.classList.add('has-action-bar');
  const effectiveMaxForLabel = getClientSlug() ? MAX_FILES : FREE_MAX_FILES;
  const truncatedNote = truncated
    ? (getClientSlug() ? ' (лишние не добавлены)' : ' — бесплатный лимит пачки, для больших объёмов нужен платный пакет')
    : '';
  fileCountLabel.textContent = `Выбрано файлов: ${selectedFiles.length} из ${effectiveMaxForLabel}` + truncatedNote;
  recognizeBtn.textContent = `Распознать текст (${selectedFiles.length})`;

  fileListItems.innerHTML = '';
  selectedFiles.forEach((file, idx) => fileListItems.appendChild(buildFileRow(file, idx)));

  onChange();
}

export function initFileList({ onChange: onChangeCallback }) {
  onChange = onChangeCallback || onChange;

  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', e => {
    if (e.target.files.length) addFiles(e.target.files);
    fileInput.value = ''; // позволяет выбрать те же файлы повторно, если убрали и передумали
  });
  cameraInput.addEventListener('change', e => {
    if (e.target.files.length) addFiles(e.target.files);
    cameraInput.value = '';
  });
  clearAllBtn.addEventListener('click', () => {
    if (recognizeBtn.disabled) return; // идёт распознавание — отмена сейчас недоступна
    selectedFiles = [];
    selectedDocTypes = [];
    render(false);
  });
  // Выбор типа документа по умолчанию скрыт (см. .file-type-select в styles.css) —
  // показываем его только если пользователь явно попросил уточнить тип вручную.
  manualTypeToggle.addEventListener('change', () => {
    fileListItems.classList.toggle('show-type-select', manualTypeToggle.checked);
  });
}

export function getSelectedFiles() {
  return selectedFiles;
}

// Добавляет файл в список программно (не из <input>/drag&drop) — используется
// кнопкой «Попробовать на примере» в app.js.
export function addExternalFile(file) {
  addFiles([file]);
}

export function getSelectedDocTypes() {
  return selectedDocTypes;
}

// Вызывается branding.js после того, как подгрузился конфиг клиентского пилота
// (см. tamga_api_key_fields.custom_doc_types) — может случиться уже после того,
// как человек начал добавлять файлы, поэтому дописываем опции в уже
// отрисованные <select>, а не гоняем полный render() (тот пересоздаёт все
// object URL превью — лишняя работа и риск моргнуть уже показанные миниатюры).
export function setExtraDocTypes(names) {
  extraDocTypes = Array.isArray(names) ? names : [];
  if (!extraDocTypes.length) return;

  fileListItems.querySelectorAll('.file-type-select').forEach(select => {
    let group = select.querySelector('optgroup');
    if (!group) {
      group = document.createElement('optgroup');
      group.label = 'Ваши типы';
      select.appendChild(group);
    }
    extraDocTypes.forEach(name => {
      if (![...select.options].some(o => o.value === name)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        group.appendChild(opt);
      }
    });
  });
}

export function setControlsDisabled(disabled) {
  fileListItems.querySelectorAll('.remove-file').forEach(el => el.disabled = disabled);
  fileListItems.querySelectorAll('.file-type-select').forEach(el => el.disabled = disabled);
  clearAllBtn.disabled = disabled;
}
