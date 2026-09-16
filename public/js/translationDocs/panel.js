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
import { runWithConcurrency } from '../utils/concurrencyPool.js';
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs';

const DOC_TYPE_LABELS = { apostille: 'Апостиль' };
const MAX_TRANSLATION_CONCURRENCY = 20;

async function recognizeViaApi(token, slug, base64, mimeType, language, pageCount) {
  const res = await fetch('/api/translation-docs/client-recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-token': token },
    body: JSON.stringify({ image: base64, mimeType, clientSlug: slug, language, pageCount })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

async function getPageCount(file) {
  if (file.type !== 'application/pdf') return 1;
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  return Math.max(1, pdf.numPages);
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
  const regulationNote = el('div', null, 'admin-note');
  regulationNote.style.marginTop = '8px';
  colFields.append(regulationNote);

  const exportToolbar = el('div', null, 'acct-export-toolbar');
  const exportDocxBtn = button('Скачать .docx'); exportDocxBtn.prepend(docxIcon());
  const exportTxtBtn = button('Скачать .txt');
  const printBtn = button('Печать / PDF');
  const compareBtn = button('Сравнить оригинал и перевод');
  [exportDocxBtn, exportTxtBtn, printBtn, compareBtn].forEach(b => { b.disabled = true; });
  exportToolbar.append(exportDocxBtn, exportTxtBtn, printBtn, compareBtn);
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
    [exportDocxBtn, exportTxtBtn, printBtn, compareBtn].forEach(b => b.disabled = true);
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
      const labelCell = el('td');
      labelCell.append(el('span', f.targetLabel || f.label));
      const statusLabels = {
        translated: ['Перевод', '#18794e'],
        transliterated: ['Транслитерировано', '#7c3aed'],
        preserved: ['Сохранено', '#52606d']
      };
      const status = statusLabels[f.translationStatus];
      if (status) {
        const badge = el('span', status[0]);
        badge.style.cssText = `display:inline-block;margin-left:8px;padding:2px 7px;border-radius:10px;background:${status[1]};color:#fff;font-size:11px;white-space:nowrap`;
        labelCell.append(badge);
      }
      row.append(labelCell);
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
    const translation = { name, fields: visible.map(f => ({ label: f.targetLabel || f.label, value: f.translated || '' })), columns: [], items: [], keys: [], paragraphs: [] };
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
      [exportDocxBtn, exportTxtBtn, printBtn, compareBtn].forEach(b => b.disabled = true);
      if (doc.error) {
        tdError.textContent = `Ошибка файла "${doc.file.name}": ${doc.error}`;
        tdError.style.display = '';
      }
      return;
    }
    const data = doc.result;
    docTypeLabel.textContent = DOC_TYPE_LABELS[data.doc_type] || data.doc_type;
    regulationNote.replaceChildren();
    const regulationTitle = data.regulation?.title || 'Требования принимающего органа';
    const regulationNoteText = data.regulation?.note ||
      'Перед подачей проверьте требования страны назначения, включая легализацию и заверение перевода.';
    const regulationList = document.createElement('ul');
    regulationList.style.margin = '6px 0 0';
    regulationList.style.paddingLeft = '20px';
    [
      `Регуляция: ${regulationTitle}`,
      regulationNoteText,
      'Перевод выполнен автоматически',
      'Перед подачей проверьте требования принимающего органа',
      'При необходимости заверьте перевод у уполномоченного переводчика или нотариуса'
    ].forEach(item => regulationList.append(el('li', item)));
    regulationNote.append(el('strong', 'Важная информация'), regulationList);
    renderFieldsTable(data.fields);
    resultPanel.style.display = '';
    [exportDocxBtn, exportTxtBtn, printBtn, compareBtn].forEach(b => b.disabled = false);
  }

  async function translateOne(doc, language) {
    doc.status = 'recognizing';
    doc.error = null;
    refreshFileList();
    try {
      const base64 = await fileToBase64(doc.file);
      const pageCount = await getPageCount(doc.file);
      const data = await recognizeViaApi(token, slug, base64, doc.file.type, language, pageCount);
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

    const pending = docs.map((doc, index) => ({ doc, index })).filter(({ doc }) => doc.status === 'pending' || doc.status === 'error');
    let firstDoneIndex = -1;
    let anyError = false;
    let done = 0;

    await runWithConcurrency(pending, MAX_TRANSLATION_CONCURRENCY, async ({ doc, index }) => {
      progressText.textContent = `Переводим ${done + 1} из ${pending.length}...`;
      await translateOne(doc, language);
      done += 1;
      progressFill.style.width = `${Math.round((done / pending.length) * 100)}%`;
      if (doc.status === 'done' && firstDoneIndex === -1) firstDoneIndex = index;
      if (doc.status === 'error') anyError = true;
    });

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

  compareBtn.addEventListener('click', () => {
    const doc = docs[activeIndex];
    if (!doc || doc.status !== 'done' || !doc.result) return;
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
    const rows = doc.result.fields
      .filter(field => field.value || field.translated)
      .map(field => `<tr data-key="${escapeHtml(field.key)}"><th><input class="compare-label" value="${escapeHtml(field.targetLabel || field.label)}"><select class="compare-status"><option value="translated" ${field.translationStatus === 'translated' ? 'selected' : ''}>Перевод</option><option value="transliterated" ${field.translationStatus === 'transliterated' ? 'selected' : ''}>Транслитерировано</option><option value="preserved" ${field.translationStatus === 'preserved' ? 'selected' : ''}>Сохранено</option></select><button class="compare-delete" type="button">Удалить</button></th><td><textarea class="compare-original">${escapeHtml(field.value || '')}</textarea></td><td><textarea class="compare-translated">${escapeHtml(field.translated || '')}</textarea></td></tr>`)
      .join('');
    const win = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=800');
    if (!win) {
      exportError.textContent = 'Разрешите открытие нового окна для сравнения документов.';
      exportError.style.display = '';
      return;
    }
    win.document.write(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Сравнение перевода</title>
      <style>body{font:14px Arial,sans-serif;color:#111;margin:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #bbb;padding:10px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#f3f5f7;text-align:left}thead th{position:sticky;top:0}.label{width:30%}.source,.translated{width:35%}@media print{button{display:none}}</style>
      <h1>${escapeHtml(doc.file.name)}</h1><p>Сверка оригинала и перевода</p>
      <button id="compare-add" type="button">Добавить поле</button>
      <button id="compare-save" type="button">Сохранить изменения</button>
      <table><thead><tr><th class="label">Поле</th><th class="source">Оригинал</th><th class="translated">Перевод</th></tr></thead><tbody>${rows}</tbody></table></html>`);
    win.document.close();
    const sync = () => {
      const fields = [];
      win.document.querySelectorAll('tbody tr').forEach(row => {
        const field = doc.result.fields.find(item => item.key === row.dataset.key);
        if (!field) return;
        field.targetLabel = row.querySelector('.compare-label').value;
        field.value = row.querySelector('.compare-original').value;
        field.translated = row.querySelector('.compare-translated').value;
        field.translationStatus = row.querySelector('.compare-status').value;
        fields.push(field);
      });
      doc.result.fields = fields;
      renderFieldsTable(doc.result.fields);
    };
    win.document.getElementById('compare-save').onclick = sync;
    win.document.querySelectorAll('.compare-delete').forEach(button => {
      button.onclick = () => { button.closest('tr').remove(); sync(); };
    });
    win.document.getElementById('compare-add').onclick = () => {
      const key = `custom_${Date.now()}`;
      doc.result.fields.push({
        key, label: 'Новое поле', targetLabel: 'Новое поле',
        value: '', translated: '', translationStatus: 'translated', confidence: 100
      });
      const row = win.document.createElement('tr');
      row.dataset.key = key;
      row.innerHTML = `<th><input class="compare-label" value="Новое поле"><select class="compare-status"><option value="translated">Перевод</option><option value="transliterated">Транслитерировано</option><option value="preserved">Сохранено</option></select><button class="compare-delete" type="button">Удалить</button></th><td><textarea class="compare-original"></textarea></td><td><textarea class="compare-translated"></textarea></td>`;
      win.document.querySelector('tbody').append(row);
      row.querySelector('.compare-delete').onclick = () => { row.remove(); sync(); };
      row.querySelector('.compare-label').focus();
    };
  });
}
