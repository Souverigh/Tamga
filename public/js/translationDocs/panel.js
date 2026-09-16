// public/js/translationDocs/panel.js — клиентская веб-панель модуля
// "Перевод" (Ethan, 16 сен 2026: "то же самое [что бухгалтерия] для
// перевода — отдельная загрузка, как бухгалтерия; общий лимит страниц с
// распознаванием; плюс апостиль и другие типы документов", уточнено через
// AskUserQuestion).
//
// Раньше перевод жил ВНУТРИ обычного потока распознавания (public/js/
// translation/panel.js, вставлялся в #resultsPanel и переводил уже
// извлечённые поля документа, распознанного на вкладке "Распознавание", по
// своей отдельной дневной/месячной квоте запросов — lib/translationQuota.js).
// Этот модуль — прямая замена: отдельная вкладка "Перевод" (третья, рядом с
// "Распознавание"/"Бухгалтерия", через общий public/js/contentTabs.js),
// свой собственный поток загрузки файла → распознавание типа документа →
// перевод полей, списывающий ТУ ЖЕ страницу общего пакета клиента
// (api/translation-docs/client-recognize.js → lib/translationDocs/pipeline.js).
// Старый public/js/translation/panel.js/api/translate.js остаются в
// кодовой базе нетронутыми, но больше не подключаются из app.js.
//
// По образцу public/js/accounting/panel.js: весь DOM строится в JS,
// показывается только платным клиентам (slug + валидный x-client-token),
// переиспользует DOM-агностичные fileQueue.js/render.js/labels.js из
// public/admin/accounting/ (тот же список файлов, что уже показал, что
// хорошо переиспользуется между панелями — ничего в них не знает про
// бухгалтерию конкретно, только про форму {file, status, result, error}).
import { getClientSlug, getClientToken } from '../branding.js';
import { registerTab } from '../contentTabs.js';
import { renderFileList, renderPreview } from '../../admin/accounting/render.js';
import { createDocsFromFiles, fileToBase64 } from '../../admin/accounting/fileQueue.js';
import { LOW_CONFIDENCE_THRESHOLD } from '../../admin/accounting/labels.js';
import { LANGUAGES } from '../translation/model.mjs';
import { exportTxt, exportDocx, printTranslation } from '../translation/export.mjs';

const DOC_TYPE_LABELS = { apostille: 'Апостиль' };

async function recognizeViaApi(token, slug, base64, mimeType, language) {
  const res = await fetch('/api/translation-docs/client-recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-token': token },
    body: JSON.stringify({ image: base64, mimeType, clientSlug: slug, language })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (text, cls = 'btn-secondary') => { const b = el('button', text, cls); b.type = 'button'; return b; };
const svg = (paths, viewBox = '0 0 24 24') => {
  const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wrap.setAttribute('viewBox', viewBox);
  wrap.setAttribute('fill', 'none');
  wrap.setAttribute('stroke', 'currentColor');
  wrap.setAttribute('stroke-width', '2');
  wrap.setAttribute('stroke-linecap', 'round');
  wrap.setAttribute('stroke-linejoin', 'round');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = paths;
  return wrap;
};

// Тот же глиф, что был у translation-icon в старой панели (public/css/
// translation.css) — визуальная преемственность, теперь в квадрате
// acct-panel-icon, как у бухгалтерии.
function panelIcon() {
  const box = el('span', null, 'acct-panel-icon');
  const icon = svg('<path d="M5 8h9M9 5v3M11 8c0 4-3 7-6 8M9.5 12c1.5 1.5 3.5 2.5 5.5 3"/><path d="M14 21l4-9 4 9M15.5 18h5"/>');
  icon.setAttribute('width', '16'); icon.setAttribute('height', '16');
  box.append(icon);
  return box;
}

function docxIcon() {
  const icon = svg('<rect x="2.5" y="3" width="15" height="14" rx="1"/><line x1="2.5" y1="8" x2="17.5" y2="8"/><path d="M5.5 12l1.2 3 1.3-3 1.3 3 1.2-3"/>', '0 0 20 20');
  icon.setAttribute('width', '16'); icon.setAttribute('height', '16');
  icon.setAttribute('stroke-width', '1.5');
  icon.classList.add('btn-icon');
  return icon;
}

export async function initTranslationDocs() {
  const slug = getClientSlug(), token = getClientToken();
  if (!slug || !token) return; // не платный клиент с паролем — вкладка не показывается

  // --- корневой блок панели + регистрация вкладки "Перевод" ---------------
  const root = el('section', null, 'panel acct-wrap');
  root.id = 'translationDocsPanel';

  const panelHeader = el('div', null, 'acct-panel-header');
  const panelTitle = el('div', null, 'acct-panel-header-title');
  panelTitle.append(panelIcon(), el('h2', 'Перевод документов'));
  panelHeader.append(panelTitle);
  root.append(panelHeader);
  root.append(el('p', 'Апостиль — распознавание и перевод на выбранный язык. Расходует тот же пакет страниц, что и обычное распознавание.', 'admin-note'));

  if (!registerTab('translation-docs', 'Перевод', root)) return; // защитно — без #recognizeFlow регистрировать нечего

  // --- язык перевода --------------------------------------------------------
  const langRow = el('div', null, 'translation-field');
  langRow.append(el('span', 'Язык перевода', 'translation-field-label'));
  const langSelect = el('select');
  langSelect.setAttribute('aria-label', 'Язык перевода');
  Object.entries(LANGUAGES).forEach(([value, label]) => { const o = el('option', label); o.value = value; langSelect.append(o); });
  langSelect.value = 'en';
  langRow.append(langSelect);
  langRow.style.marginBottom = '12px';
  root.append(langRow);

  // --- загрузка файлов — тот же .dropzone, что у главного экрана и у
  // модуля бухгалтерии, с drag&drop. -----------------------------------------
  const dropzone = el('label', null, 'dropzone');
  dropzone.append(el('div', '📄', 'icon'), el('div', 'Нажмите здесь или перетащите файл', 'main'), el('div', 'Фото, скан или PDF — можно сразу несколько', 'sub'));
  const fileInput = el('input'); fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/webp,application/pdf'; fileInput.multiple = true;
  dropzone.append(fileInput);
  root.append(dropzone);

  const fileListEl = el('div', null, 'acct-file-list'); fileListEl.style.display = 'none';
  root.append(fileListEl);

  const translateBtn = button('Перевести', 'btn-primary');
  translateBtn.style.marginTop = '12px';
  translateBtn.disabled = true;
  root.append(translateBtn);

  const tdError = el('div', null, 'admin-error'); tdError.style.display = 'none';

  // Прогресс пачки — тот же .progress-track/.progress-fill, что у обычного
  // распознавания и у бухгалтерии.
  const progressWrap = el('div'); progressWrap.style.display = 'none'; progressWrap.style.marginTop = '10px';
  const progressText = el('div', null, 'admin-note');
  const progressTrack = el('div', null, 'progress-track');
  const progressFill = el('div', null, 'progress-fill');
  progressTrack.append(progressFill);
  progressWrap.append(progressText, progressTrack);
  root.append(tdError, progressWrap);

  const resultPanel = el('section'); resultPanel.style.display = 'none';
  const columns = el('div', null, 'acct-columns');

  const colOriginal = el('div', null, 'panel acct-col-original');
  colOriginal.append(el('div', 'Оригинал', 'step-label'));
  const previewBox = el('div');
  colOriginal.append(previewBox);

  const colFields = el('div', null, 'panel acct-col-fields');
  const statusRow = el('div', null, 'acct-status-row');
  const docTypeLabel = el('div', 'Документ', 'step-label'); docTypeLabel.style.margin = '0';
  statusRow.append(docTypeLabel);
  colFields.append(statusRow);

  const exportToolbar = el('div', null, 'acct-export-toolbar');
  const exportDocxBtn = button('Скачать .docx'); exportDocxBtn.prepend(docxIcon());
  const exportTxtBtn = button('Скачать .txt');
  const printBtn = button('Печать / PDF');
  [exportDocxBtn, exportTxtBtn, printBtn].forEach(b => { b.disabled = true; });
  exportToolbar.append(exportDocxBtn, exportTxtBtn, printBtn);
  const exportError = el('div', null, 'admin-error'); exportError.style.display = 'none';
  colFields.append(exportToolbar, exportError);

  const fieldsTable = el('table', null, 'admin-table acct-header-table');
  colFields.append(fieldsTable);

  columns.append(colOriginal, colFields);
  resultPanel.append(columns);
  root.append(resultPanel);

  // --- состояние и обработчики (по образцу public/js/accounting/panel.js) --
  let docs = [];
  let activeIndex = -1;

  function refreshFileList() { renderFileList(fileListEl, docs, activeIndex, selectDoc); }

  function loadFiles(fileList) {
    if (!fileList || !fileList.length) return;
    docs = createDocsFromFiles(fileList);
    activeIndex = -1;
    resultPanel.style.display = 'none';
    [exportDocxBtn, exportTxtBtn, printBtn].forEach(b => b.disabled = true);
    tdError.style.display = 'none';
    refreshFileList();
    translateBtn.disabled = false;
  }

  fileInput.addEventListener('change', () => {
    loadFiles(fileInput.files);
    fileInput.value = ''; // позволяет выбрать те же файлы повторно
  });
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });

  function renderFieldsTable(fields) {
    fieldsTable.innerHTML = '';
    const visible = fields.filter(f => f.value && f.value.trim());
    if (!visible.length) {
      fieldsTable.append(el('caption', 'Поля не распознаны.'));
      return;
    }
    const thead = el('thead');
    const headRow = el('tr');
    ['Поле', 'Оригинал', 'Перевод'].forEach(t => headRow.append(el('th', t)));
    thead.append(headRow);
    const tbody = el('tbody');
    visible.forEach(f => {
      const row = el('tr');
      row.append(el('td', f.label));
      const valueTd = el('td', f.value || '—');
      if (f.confidence != null && f.confidence < LOW_CONFIDENCE_THRESHOLD) valueTd.classList.add('acct-low-confidence');
      row.append(valueTd);
      row.append(el('td', f.translated || '—'));
      tbody.append(row);
    });
    fieldsTable.append(thead, tbody);
  }

  // Форма {name, fields:[{label,value}], columns:[], items:[], keys:[],
  // paragraphs:[]}, которую понимает public/js/translation/export.mjs
  // (pairedLayoutBlocks и производные exportDocx/exportTxt/printTranslation)
  // — переиспользуется как есть, только вместо документов из обычного
  // потока сюда попадают поля апостиля.
  function buildExportDocs(doc) {
    const visible = doc.result.fields.filter(f => f.value && f.value.trim());
    const name = doc.file.name;
    const original = { name, fields: visible.map(f => ({ label: f.label, value: f.value })), columns: [], items: [], keys: [], paragraphs: [] };
    const translation = { name, fields: visible.map(f => ({ label: f.label, value: f.translated || '' })), columns: [], items: [], keys: [], paragraphs: [] };
    return { original, translation };
  }

  async function selectDoc(index) {
    const doc = docs[index];
    if (!doc) return;
    activeIndex = index;
    refreshFileList();

    const base64 = await fileToBase64(doc.file);
    renderPreview(previewBox, doc.file.type, base64);

    if (doc.status !== 'done' || !doc.result) {
      resultPanel.style.display = 'none';
      [exportDocxBtn, exportTxtBtn, printBtn].forEach(b => b.disabled = true);
      return;
    }
    const data = doc.result;
    docTypeLabel.textContent = DOC_TYPE_LABELS[data.doc_type] || data.doc_type;
    renderFieldsTable(data.fields);
    resultPanel.style.display = '';
    [exportDocxBtn, exportTxtBtn, printBtn].forEach(b => b.disabled = false);
  }

  async function translateOne(doc, language) {
    doc.status = 'recognizing';
    doc.error = null;
    refreshFileList();
    try {
      const base64 = await fileToBase64(doc.file);
      const data = await recognizeViaApi(token, slug, base64, doc.file.type, language);
      doc.status = 'done';
      doc.result = data;
    } catch (err) {
      doc.status = 'error';
      doc.error = err.message || 'Не удалось распознать документ';
    }
    refreshFileList();
  }

  translateBtn.addEventListener('click', async () => {
    if (!docs.length) return;
    const language = langSelect.value;
    tdError.style.display = 'none';
    translateBtn.disabled = true;
    [exportDocxBtn, exportTxtBtn, printBtn].forEach(b => b.disabled = true);
    progressWrap.style.display = '';
    progressFill.style.width = '0%';

    // Последовательно, не параллельно — тот же приём, что у бухгалтерии
    // (Gemini free tier ~20 запросов/мин, см. ways-of-working.md).
    const pending = docs.map((doc, index) => ({ doc, index })).filter(({ doc }) => doc.status === 'pending' || doc.status === 'error');
    let firstDoneIndex = -1;
    let anyError = false;
    let done = 0;

    for (const { doc, index } of pending) {
      progressText.textContent = `Переводим ${done + 1} из ${docs.length}...`;
      await translateOne(doc, language);
      done += 1;
      progressFill.style.width = `${Math.round((done / pending.length) * 100)}%`;
      if (doc.status === 'done' && firstDoneIndex === -1) firstDoneIndex = index;
      if (doc.status === 'error') anyError = true;
    }

    progressWrap.style.display = 'none';
    translateBtn.disabled = false;
    if (anyError) {
      const errored = docs.filter(d => d.status === 'error').length;
      tdError.textContent = `Не удалось перевести ${errored} из ${docs.length} файлов — см. статус в списке файлов.`;
      tdError.style.display = '';
    }

    const showIndex = firstDoneIndex !== -1 ? firstDoneIndex : (docs.length ? 0 : -1);
    if (showIndex !== -1) await selectDoc(showIndex);
  });

  exportDocxBtn.addEventListener('click', async () => {
    const doc = docs[activeIndex];
    if (!doc || doc.status !== 'done') return;
    exportError.style.display = 'none';
    try {
      const { original, translation } = buildExportDocs(doc);
      await exportDocx(original, translation, true);
    } catch (err) {
      exportError.textContent = err.message || 'Не удалось собрать .docx';
      exportError.style.display = '';
    }
  });

  exportTxtBtn.addEventListener('click', () => {
    const doc = docs[activeIndex];
    if (!doc || doc.status !== 'done') return;
    exportError.style.display = 'none';
    try {
      const { original, translation } = buildExportDocs(doc);
      exportTxt(original, translation, true);
    } catch (err) {
      exportError.textContent = err.message || 'Не удалось собрать .txt';
      exportError.style.display = '';
    }
  });

  printBtn.addEventListener('click', () => {
    const doc = docs[activeIndex];
    if (!doc || doc.status !== 'done') return;
    exportError.style.display = 'none';
    try {
      const { original, translation } = buildExportDocs(doc);
      printTranslation(original, translation, true);
    } catch (err) {
      exportError.textContent = err.message || 'Не удалось открыть окно печати';
      exportError.style.display = '';
    }
  });
}
