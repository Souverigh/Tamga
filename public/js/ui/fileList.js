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

let selectedFiles = []; // (File | GroupObject)[] — GroupObject: { __group, id, name, files: File[] }
let selectedDocTypes = []; // string[], параллельно selectedFiles — 'auto' или значение из DOC_TYPES/extraDocTypes
let previewUrls = []; // string[], object URL на каждый файл (для группы — превью первого файла) — для просмотра/скачивания
let onChange = () => {};
// Кастомные типы документов текущего клиентского пилота (см. branding.js,
// tamga_api_key_fields.custom_doc_types) — подгружаются асинхронно, поэтому
// могут появиться уже после того, как человек начал добавлять файлы.
let extraDocTypes = [];
// Индексы в selectedFiles, отмеченные чекбоксом для объединения в документ
// (Ethan, 8 сен 2026: "договор на 5 страниц, сфотографировал 5 раз, а они
// вообще не связаны") — см. groupSelectedFiles/openGroupOrderOverlay ниже.
// Сбрасывается при любом структурном изменении списка (render()) — индексы
// иначе легко устаревают (файл удалили/добавили — нумерация съехала).
let groupSelection = new Set();

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const cameraInput = document.getElementById('cameraInput');
const fileList = document.getElementById('fileList');
const fileCountLabel = document.getElementById('fileCountLabel');
const fileListItems = document.getElementById('fileListItems');
const clearAllBtn = document.getElementById('clearAllBtn');
const groupSelectedBtn = document.getElementById('groupSelectedBtn');
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

function updateGroupButtonVisibility() {
  const count = groupSelection.size;
  if (count >= 2) {
    groupSelectedBtn.style.display = 'inline-flex';
    groupSelectedBtn.textContent = `Объединить в документ (${count})`;
  } else {
    groupSelectedBtn.style.display = 'none';
  }
}

// Полноэкранный оверлей проверки/перестановки порядка страниц перед
// объединением (Ethan, 8 сен 2026: "а как человек может разглядеть номера
// страниц, если на фотках нечётко" — решение: миниатюры кликабельны, как и в
// обычном списке файлов, открывают оригинал в полный размер). Стартовый
// порядок — по времени съёмки файла (lastModified): если человек фотографировал
// страницы одну за другой по порядку (обычный случай), ничего поправлять не
// придётся вообще; кнопки вверх/вниз — на случай, если порядок всё же не совпал.
// Возвращает Promise<File[] | null> — null при отмене.
function openGroupOrderOverlay(files) {
  return new Promise(resolve => {
    let order = [...files].sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
    const urlByFile = new Map(files.map(f => [f, URL.createObjectURL(f)]));

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    const box = document.createElement('div');
    box.className = 'confirm-box group-order-box';

    const title = document.createElement('div');
    title.className = 'confirm-message';
    title.style.marginBottom = '4px';
    title.textContent = `Порядок страниц (${order.length})`;
    box.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'group-order-hint';
    hint.textContent = 'Расставлены по времени съёмки. Нажмите на миниатюру, чтобы увеличить, и поправьте порядок стрелками, если что-то не так.';
    box.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'group-order-list';
    box.appendChild(list);

    function renderList() {
      list.innerHTML = '';
      order.forEach((f, i) => {
        const item = document.createElement('div');
        item.className = 'group-order-item';

        const num = document.createElement('div');
        num.className = 'group-order-num';
        num.textContent = String(i + 1);
        item.appendChild(num);

        const thumbLink = document.createElement('a');
        thumbLink.className = 'group-order-thumb';
        thumbLink.href = urlByFile.get(f);
        thumbLink.target = '_blank';
        thumbLink.rel = 'noopener';
        thumbLink.title = 'Открыть в полный размер';
        const img = document.createElement('img');
        img.src = urlByFile.get(f);
        img.alt = '';
        thumbLink.appendChild(img);
        item.appendChild(thumbLink);

        const name = document.createElement('div');
        name.className = 'group-order-name';
        name.textContent = f.name;
        item.appendChild(name);

        const moves = document.createElement('div');
        moves.className = 'group-order-moves';
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.textContent = '↑';
        upBtn.title = 'Переместить выше';
        upBtn.disabled = i === 0;
        upBtn.addEventListener('click', () => {
          [order[i - 1], order[i]] = [order[i], order[i - 1]];
          renderList();
        });
        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.textContent = '↓';
        downBtn.title = 'Переместить ниже';
        downBtn.disabled = i === order.length - 1;
        downBtn.addEventListener('click', () => {
          [order[i + 1], order[i]] = [order[i], order[i + 1]];
          renderList();
        });
        moves.appendChild(upBtn);
        moves.appendChild(downBtn);
        item.appendChild(moves);

        list.appendChild(item);
      });
    }
    renderList();

    const actions = document.createElement('div');
    actions.className = 'btn-row confirm-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Отмена';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn-primary';
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Объединить';
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    box.appendChild(actions);

    overlay.appendChild(box);

    function cleanup() {
      urlByFile.forEach(u => URL.revokeObjectURL(u));
      overlay.remove();
    }
    cancelBtn.addEventListener('click', () => { cleanup(); resolve(null); });
    confirmBtn.addEventListener('click', () => { cleanup(); resolve(order); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { cleanup(); resolve(null); } });

    document.body.appendChild(overlay);
  });
}

// Объединяет отмеченные чекбоксами файлы в одну группу (многостраничный
// "виртуальный файл") — дальше идёт по уже существующему пути многостраничных
// документов (см. app.js:loadPageImages), тому же, что уже работает для PDF.
function groupSelectedFiles() {
  if (groupSelection.size < 2) return;
  const indices = [...groupSelection].sort((a, b) => a - b);
  const files = indices.map(i => selectedFiles[i]);

  openGroupOrderOverlay(files).then(orderedFiles => {
    if (!orderedFiles) return; // отмена в оверлее — ничего не меняем

    const groupObj = {
      __group: true,
      id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: `Документ (${orderedFiles.length} файлов)`,
      files: orderedFiles
    };

    // Убираем исходные файлы С КОНЦА (чтобы индексы не съезжали при splice),
    // вставляем группу на место первого по счёту (наименьший индекс) из
    // выбранных — группа остаётся примерно там же, где были её файлы.
    const insertAt = indices[0];
    for (let k = indices.length - 1; k >= 0; k--) {
      selectedFiles.splice(indices[k], 1);
      selectedDocTypes.splice(indices[k], 1);
    }
    selectedFiles.splice(insertAt, 0, groupObj);
    selectedDocTypes.splice(insertAt, 0, 'auto');

    render(false);
  });
}

// Возвращает файлы группы обратно в список как отдельные строки.
function ungroupAt(idx) {
  const groupObj = selectedFiles[idx];
  if (!groupObj || !groupObj.__group) return;
  selectedFiles.splice(idx, 1, ...groupObj.files);
  selectedDocTypes.splice(idx, 1, ...groupObj.files.map(() => 'auto'));
  render(false);
}

function buildFileRow(file, idx) {
  const isGroup = !!(file && file.__group);
  const row = document.createElement('div');
  row.className = 'file-row';

  // Чекбокс объединения — только для обычных файлов-картинок, не PDF (тот уже
  // сам многостраничный) и не уже собранной группы (группу в группу не кладём).
  if (!isGroup && file.type !== 'application/pdf') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'group-select';
    checkbox.title = 'Выбрать для объединения в один документ';
    checkbox.checked = groupSelection.has(idx);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) groupSelection.add(idx); else groupSelection.delete(idx);
      updateGroupButtonVisibility();
    });
    row.appendChild(checkbox);
  }

  const thumb = document.createElement(isGroup ? 'div' : 'a');
  thumb.className = 'file-thumb';
  if (isGroup) {
    thumb.classList.add('file-thumb-stack');
    thumb.textContent = String(file.files.length);
    thumb.title = `${file.files.length} файлов объединены в один документ`;
  } else {
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
  }
  row.appendChild(thumb);

  const info = document.createElement('div');
  info.className = 'file-row-main';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = file.name;
  name.title = isGroup
    ? `${file.name}: ${file.files.map(f => f.name).join(', ')}`
    : `${file.name} (${formatSize(file.size)})`; // полное имя и размер — по наведению/долгому нажатию
  info.appendChild(name);
  row.appendChild(info);

  const controls = document.createElement('div');
  controls.className = 'file-row-controls';

  if (!isGroup) {
    const downloadFileBtn = document.createElement('a');
    downloadFileBtn.className = 'file-download';
    downloadFileBtn.href = previewUrls[idx];
    downloadFileBtn.download = file.name;
    downloadFileBtn.title = 'Скачать оригинал файла';
    downloadFileBtn.textContent = '⬇';
    controls.appendChild(downloadFileBtn);
  }

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

  if (isGroup) {
    const ungroupBtn = document.createElement('button');
    ungroupBtn.className = 'ungroup-file';
    ungroupBtn.type = 'button';
    ungroupBtn.textContent = 'Разгруппировать';
    ungroupBtn.title = 'Вернуть как отдельные файлы';
    ungroupBtn.addEventListener('click', () => {
      if (recognizeBtn.disabled) return;
      ungroupAt(idx);
    });
    controls.appendChild(ungroupBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-file';
  removeBtn.textContent = '×';
  removeBtn.title = isGroup ? 'Убрать весь документ' : 'Убрать этот файл';
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
  // Для группы — превью первого файла (страница 1), сама группа не Blob и
  // URL.createObjectURL на ней бы упал.
  previewUrls = selectedFiles.map(f => (f && f.__group)
    ? (f.files && f.files[0] ? URL.createObjectURL(f.files[0]) : null)
    : URL.createObjectURL(f));

  // Индексы для объединения всегда сбрасываем при перерисовке — любое
  // структурное изменение списка (добавили/убрали/сгруппировали файл) сдвигает
  // нумерацию, держать отмеченные чекбоксы актуальными не стоит усложнения.
  groupSelection.clear();
  updateGroupButtonVisibility();

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
  groupSelectedBtn.addEventListener('click', () => {
    if (recognizeBtn.disabled) return;
    groupSelectedFiles();
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

// Ethan, 8 сен 2026: настоящая причина, по которой распознанный/выбранный
// вручную кастомный тип документа ("Медицинская страховка" и т.п.) в итоге
// всегда показывался как "Другое" — app.js:finalizeFileResult проверял
// docType только по стандартному DOC_TYPES (см. lib/docSchema.js), не зная
// о кастомных типах клиента вообще, и молча заменял ЛЮБОЙ кастомный тип на
// "Другое" — даже когда сервер (или сам человек вручную, см. selectedDocTypes
// выше) верно определил именно кастомный тип. Это НЕ имело отношения к
// качеству классификации Gemini (см. коммит про добавление списка полей
// в подсказку) — сброс происходил уже НА КЛИЕНТЕ, после ответа сервера.
// Геттер нужен app.js, чтобы проверять docType по ОБЪЕДИНЁННОМУ списку
// (DOC_TYPES + кастомные типы этого клиента), а не только по стандартному.
export function getExtraDocTypes() {
  return extraDocTypes;
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
  fileListItems.querySelectorAll('.group-select').forEach(el => el.disabled = disabled);
  fileListItems.querySelectorAll('.ungroup-file').forEach(el => el.disabled = disabled);
  clearAllBtn.disabled = disabled;
  groupSelectedBtn.disabled = disabled;
}
