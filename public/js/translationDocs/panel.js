import { buildExportDocs } from './export-model.mjs';
import { TRANSLATION_STATUSES } from '../translation/field-rules.mjs';
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
import { getClientSlug, getClientToken, getClientBranding } from '../branding.js';
import { registerTab } from '../contentTabs.js';
import { renderFileList, renderPreview } from '../../admin/accounting/render.js';
import { createDocsFromFiles, fileToBase64 } from '../../admin/accounting/fileQueue.js';
import { LOW_CONFIDENCE_THRESHOLD } from '../../admin/accounting/labels.js';
import { LANGUAGES } from '../translation/model.mjs';
import { exportTxt, exportDocx, downloadTranslationPdf, apostilleConvention } from '../translation/export.mjs';
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
  if (!res.ok) {
    const messages = {
      QUOTA_EXCEEDED: 'Лимит страниц по вашему тарифу исчерпан.',
      QUOTA_UNAVAILABLE: 'Сервис учёта лимита временно недоступен. Повторите попытку позже.',
      wrong_doc_type: 'Не удалось определить тип документа. Загрузите более чёткий скан.',
      insufficient_data: 'В документе недостаточно данных для перевода.',
      invalid_request: 'Проверьте файл и выбранный язык перевода.'
    };
    throw new Error(messages[data.code] || data.error || `Не удалось обработать документ (код ${res.status}).`);
  }
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
  let selectedLanguage = langSelect.value;

  // --- удостоверение переводчика ("под нотариальное заверение", Ethan,
  // 17 сен 2026) — необязательный блок: без ФИО переводчика футер вообще не
  // добавляется в экспорт (см. certificationBlocks в translation/export.mjs).
  // С 17 сен 2026 (мультипользовательские аккаунты, lib/clientAuth.js): если
  // залогинен персональный пользователь с ролью 'translator' — его ФИО
  // берётся из ЕГО СОБСТВЕННОЙ учётной записи (currentUser.translatorName,
  // см. branding.js) и подставляется сразу, без обращения к
  // /api/client-settings (туда у переводчика всё равно нет доступа — 403).
  // Для owner/легаси-клиентов без отдельных пользователей — как раньше,
  // общий на клиента formatting.translatorName, который можно поправить
  // прямо здесь.
  // Ethan, 17 сен 2026: "включать по умолчанию, а не по чекбоксу" — чекбокс
  // теперь ВКЛЮЧЁН с самого начала (не требует явного действия клиента).
  // Блок в экспорте всё равно не появится без заполненного ФИО переводчика
  // (см. certificationBlocks выше) — включённый по умолчанию чекбокс просто
  // означает "добавь блок, как только у тебя будет ФИО", а не "добавь пустой
  // блок". Клиент по-прежнему может снять галочку, если блок не нужен вовсе.
  const certDetails = el('details', null, 'translation-info');
  certDetails.open = true;
  certDetails.style.marginBottom = '12px';
  const certSummary = el('summary', 'Формулировка для нотариального заверения');
  certDetails.append(certSummary);
  const certBody = el('div'); certBody.style.marginTop = '10px';
  const certToggleRow = el('label'); certToggleRow.style.display = 'flex'; certToggleRow.style.alignItems = 'center'; certToggleRow.style.gap = '8px';
  const certToggle = document.createElement('input'); certToggle.type = 'checkbox'; certToggle.checked = true;
  certToggleRow.append(certToggle, el('span', 'Добавлять в конец экспорта: язык оригинала/перевода, ФИО переводчика, место для подписи, ссылку на статью закона о нотариате и место под печать нотариуса — документ можно сразу нести к нотариусу.'));
  certBody.append(certToggleRow);

  const certFieldsRow = el('div', null, 'translation-setup-row');
  certFieldsRow.style.marginTop = '10px'; certFieldsRow.style.display = '';
  const translatorField = el('div', null, 'translation-field');
  translatorField.append(el('span', 'ФИО переводчика', 'translation-field-label'));
  const translatorInput = document.createElement('input');
  translatorInput.type = 'text'; translatorInput.placeholder = 'Иванова Айгуль Бакытовна';
  translatorField.append(translatorInput);
  certFieldsRow.append(translatorField);
  certBody.append(certFieldsRow);
  certDetails.append(certBody);
  root.append(certDetails);
  // These options are managed centrally in Settings > Recognition > Translation.
  // Keep the existing export state wired below, but do not duplicate the controls here.
  certDetails.hidden = true;

  certToggle.addEventListener('change', () => { certFieldsRow.style.display = certToggle.checked ? '' : 'none'; });

  const currentUser = getClientBranding()?.currentUser;
  const isPersonalTranslator = currentUser?.role === 'translator';

  let clientCertification = {
    ...(getClientBranding()?.certification || {}),
    companyName: getClientBranding()?.displayName || getClientBranding()?.certification?.companyName || ''
  };
  if (isPersonalTranslator && currentUser.translatorName) {
    translatorInput.value = currentUser.translatorName;
    certToggle.checked = true;
    certFieldsRow.style.display = '';
  } else if (!isPersonalTranslator) {
    // Загружаем сохранённое общее ФИО переводчика один раз при открытии
    // вкладки; сбой не должен мешать работе панели — поле просто останется
    // пустым.
    fetch(`/api/client-settings?slug=${encodeURIComponent(slug)}`, { headers: { 'x-client-token': token } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        clientCertification = { ...(data?.certification || {}), companyName: data?.displayName || data?.certification?.companyName || '' };
        certToggle.checked = data?.certificationEnabled !== false;
        if (data?.translatorName) { translatorInput.value = data.translatorName; certFieldsRow.style.display = ''; }
      })
      .catch(() => {});
  }

  // Сохраняем ФИО при уходе с поля (не при каждой букве) — тот же
  // fire-and-forget принцип, что у остальных необязательных настроек здесь.
  // У персонального переводчика своё ФИО правится в «Пользователи» (только
  // владельцем) — здесь для него это просто разовая правка для конкретного
  // экспорта, никуда не сохраняется, чтобы не давать 403 от /api/client-settings.
  let lastSavedTranslatorName = '';
  translatorInput.addEventListener('blur', () => {
    if (isPersonalTranslator) return;
    const value = translatorInput.value.trim();
    if (value === lastSavedTranslatorName) return;
    lastSavedTranslatorName = value;
    fetch(`/api/client-settings?slug=${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-client-token': token },
      body: JSON.stringify({ translator_name: value })
    }).catch(() => {});
  });

  function currentCertification(doc) {
    if (!certToggle.checked || !translatorInput.value.trim()) return undefined;
    return {
      ...clientCertification,
      translatorName: translatorInput.value.trim(),
      sourceLanguage: doc?.result?.sourceLanguage || 'ru'
    };
  }

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

  const originalArea = el('section', null, 'panel acct-original-file-area');
  originalArea.style.display = 'none';
  originalArea.append(el('div', 'Оригинал', 'step-label'));
  const previewBox = el('div', null, 'acct-original-preview');
  const originalDownload = button('Скачать оригинал');
  originalDownload.prepend(svg('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>', '0 0 24 24'));
  originalDownload.disabled = true;
  originalArea.append(previewBox, originalDownload);
  root.append(originalArea);

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

  const colFields = el('div', null, 'panel acct-col-fields');
  const statusRow = el('div', null, 'acct-status-row');
  const docTypeLabel = el('div', 'Документ', 'step-label'); docTypeLabel.style.margin = '0';
  statusRow.append(docTypeLabel);
  colFields.append(statusRow);
  const qualitySummary = el('div', null, 'translation-quality-summary');
  colFields.append(qualitySummary);
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

  // "Другое"/клиентские типы несут структуру документа в data.paragraphs
  // (см. lib/translationDocs/pipeline.js, 17 сен 2026), не в fields —
  // отдельная таблица для сверки, стандартные типы её просто не покажут
  // (paragraphs пуст).
  const paragraphsHeading = el('div', 'Полный текст документа', 'step-label');
  paragraphsHeading.style.margin = '16px 0 6px'; paragraphsHeading.style.display = 'none';
  const paragraphsTable = el('table', null, 'admin-table acct-header-table');
  colFields.append(paragraphsHeading, paragraphsTable);
  const tablesHeading = el('div', 'Предметы и оценки', 'step-label');
  tablesHeading.style.margin = '16px 0 6px'; tablesHeading.style.display = 'none';
  const tablesContainer = el('div');
  colFields.append(tablesHeading, tablesContainer);

  columns.append(colFields);
  resultPanel.append(columns);
  root.append(resultPanel);

  // --- состояние и обработчики (по образцу public/js/accounting/panel.js) --
  let docs = [];
  let activeIndex = -1;

  function refreshFileList() { renderFileList(fileListEl, docs, activeIndex, selectDoc); }

  let originalDownloadUrl = null;
  function updateOriginalDownload(file, base64) {
    if (originalDownloadUrl) URL.revokeObjectURL(originalDownloadUrl);
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    originalDownloadUrl = URL.createObjectURL(new Blob([bytes], { type: file.type }));
    originalDownload.classList.add('acct-original-download');
    originalDownload.onclick = () => {
      const link = document.createElement('a');
      link.href = originalDownloadUrl;
      link.download = file.name;
      link.click();
    };
    originalDownload.disabled = false;
  }

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

  langSelect.addEventListener('change', () => {
    selectedLanguage = langSelect.value;
    if (!docs.length) return;
    docs.forEach(doc => {
      if (doc.status === 'done') {
        doc.status = 'pending';
        doc.result = null;
        doc.error = null;
      }
    });
    activeIndex = -1;
    resultPanel.style.display = 'none';
    originalArea.style.display = 'none';
    tdError.style.display = 'none';
    refreshFileList();
    translateBtn.disabled = false;
  });

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
    ['Поле', 'Оригинал', 'Перевод', 'Тип'].forEach(t => headRow.append(el('th', t)));
    thead.append(headRow);
    const tbody = el('tbody');
    visible.forEach(f => {
      const row = el('tr');
      const labelCell = el('td');
      labelCell.dataset.label = 'Поле';
      labelCell.append(el('span', f.targetLabel || f.label));
      const status = TRANSLATION_STATUSES[f.translationStatus];
      row.append(labelCell);
      const valueTd = el('td', f.value || '—');
      valueTd.dataset.label = 'Оригинал';
      if (f.requiresReview && (f.reviewedSource !== f.value || f.reviewedTranslation !== f.translated)) {
        valueTd.append(el('div', f.reviewReason || 'Требует сверки с оригиналом', 'admin-error'));
      }
      if (f.confidence != null && f.confidence < LOW_CONFIDENCE_THRESHOLD) valueTd.classList.add('acct-low-confidence');
      row.append(valueTd);
      const translatedTd = el('td', f.translated || '—');
      translatedTd.dataset.label = 'Перевод';
      row.append(translatedTd);
      const typeCell = el('td');
      typeCell.dataset.label = 'Тип';
      if (status) {
        const badge = el('span', status[0], 'translation-status-badge');
        badge.style.background = status[1];
        typeCell.append(badge);
      } else {
        typeCell.textContent = '—';
      }
      row.append(typeCell);
      tbody.append(row);
    });
    fieldsTable.append(thead, tbody);
  }

  // Read-only предпросмотр абзацев (data.paragraphs) — есть только у
  // "Другое"/клиентских типов (см. lib/translationDocs/pipeline.js,
  // 17 сен 2026); у табличных типов paragraphs пуст, секция просто скрыта.
  // Полноценное редактирование — в модалке "Сравнить оригинал и перевод"
  // ниже (compareBtn), эта таблица только для быстрого взгляда без открытия
  // модалки.
  function renderParagraphsTable(paragraphs) {
    paragraphsTable.innerHTML = '';
    const visible = (paragraphs || []).filter(p => p.text && p.text.trim());
    if (!visible.length) {
      paragraphsHeading.style.display = 'none';
      return;
    }

    paragraphsHeading.style.display = '';
    const thead = el('thead');
    const headRow = el('tr');
    ['Оригинал', 'Перевод'].forEach(t => headRow.append(el('th', t)));
    thead.append(headRow);
    const tbody = el('tbody');
    visible.forEach(p => {
      const row = el('tr');
      const original = el('td', p.text || '—'); original.dataset.label = 'Оригинал';
      const translated = el('td', p.translated || '—'); translated.dataset.label = 'Перевод';
      row.append(original, translated);
      tbody.append(row);
    });
    paragraphsTable.append(thead, tbody);
  }

  // Вынесена на верхний уровень (была случайно вложена в renderParagraphsTable
  // и потому недоступна из selectDoc, где реально вызывается — ReferenceError
  // при переводе ЛЮБОГО документа, найдено вручную через браузерную фикстуру
  // scripts/translation-tables-browser.cjs, 18 сен 2026).
  function renderSubjectTables(tables) {
    tablesContainer.replaceChildren();
    const visible = Array.isArray(tables) ? tables.filter(table => table.rows?.length) : [];
    tablesHeading.style.display = visible.length ? '' : 'none';
    visible.forEach(table => {
      const heading = el('div', table.section || 'Предметы и оценки', 'admin-section-title');
      const tableEl = el('table', null, 'admin-table acct-header-table');
      tableEl.innerHTML = '<thead><tr><th>Предмет</th><th>Оценка</th><th>Перевод предмета</th><th>Перевод оценки</th></tr></thead>';
      const body = el('tbody');
      table.rows.forEach(row => {
        const tr = el('tr');
        [row.subject, row.grade, row.translatedSubject, row.translatedGrade].forEach((value, index) => {
          const td = el('td', value || '—');
          td.dataset.label = ['Предмет', 'Оценка', 'Перевод предмета', 'Перевод оценки'][index];
          tr.append(td);
        });
        body.append(tr);
      });
      tableEl.append(body);
      tablesContainer.append(heading, tableEl);
    });
  }

  async function selectDoc(index) {
    const doc = docs[index];
    if (!doc) return;
    activeIndex = index;
    refreshFileList();

    const base64 = await fileToBase64(doc.file);
    originalArea.style.display = '';
    renderPreview(previewBox, doc.file.type, base64);
    updateOriginalDownload(doc.file, base64);

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
    exportError.style.display = 'none';
    docTypeLabel.textContent = DOC_TYPE_LABELS[data.doc_type] || data.doc_type;
    qualitySummary.replaceChildren();
    if (data.quality) {
      const recognition = data.quality.recognition;
      const translation = data.quality.translation;
      const score = (value, label, detail) => {
        const item = el('div', null, 'translation-quality-item');
        item.append(el('strong', `${label}: ${value}%`), el('span', detail, 'admin-note'));
        return item;
      };
      qualitySummary.append(
        score(recognition.score, 'Уверенность распознавания', `${recognition.populatedFields}/${recognition.totalFields} полей заполнено`),
        score(translation.score, 'Качество перевода', `${translation.translatedItems}/${translation.totalItems} элементов переведено`)
      );
      qualitySummary.title = data.quality.disclaimer || '';
    }
    regulationNote.replaceChildren();
    const regulationTitle = data.doc_type === 'apostille'
      ? apostilleConvention(selectedLanguage).replace(/^\(|\)$/g, '')
      : (data.regulation?.title || 'Требования принимающего органа');
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
    renderSubjectTables(data.tables);
    renderParagraphsTable(data.paragraphs);
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
      doc.error = err.name === 'AbortError'
        ? 'Обработка отменена.'
        : (err.message || 'Не удалось обработать документ. Проверьте файл и повторите попытку.');
    }
    refreshFileList();
  }

  translateBtn.addEventListener('click', async () => {
    if (!docs.length) return;
    const language = selectedLanguage;
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
      const { original, translation } = buildExportDocs(doc, selectedLanguage);
      await exportDocx(original, translation, false, currentCertification(doc));
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
      const { original, translation } = buildExportDocs(doc, selectedLanguage);
      exportTxt(original, translation, false, currentCertification(doc));
    } catch (err) {
      exportError.textContent = err.message || 'Не удалось собрать .txt';
      exportError.style.display = '';
    }
  });

  printBtn.addEventListener('click', async () => {
    const doc = docs[activeIndex];
    if (!doc || doc.status !== 'done') return;
    exportError.style.display = 'none';
    try {
      const { original, translation } = buildExportDocs(doc, selectedLanguage);
      await downloadTranslationPdf(translation, currentCertification(doc));
    } catch (err) {
      exportError.textContent = err.message || 'Не удалось скачать PDF';
      exportError.style.display = '';
    }
  });

  compareBtn.addEventListener('click', () => {
    const doc = docs[activeIndex];
    if (!doc || doc.status !== 'done' || !doc.result) return;
    const modal = el('div', null, 'translation-compare-modal');
    const dialog = el('div', null, 'translation-compare-dialog');
    const header = el('div', null, 'translation-compare-header');
    header.append(el('h3', `Сравнение: ${doc.file.name}`));
    const close = button('Закрыть');
    header.append(close);
    const table = el('table', null, 'admin-table translation-compare-table');
    table.innerHTML = '<thead><tr><th>Что за поле</th><th>Оригинал</th><th>Перевод</th><th>Тип</th></tr></thead>';
    const tbody = el('tbody');
    table.append(tbody);
    const makeRow = field => {
      const row = el('tr');
      row.dataset.key = field.key;
      const fieldCell = el('td');
      fieldCell.dataset.label = 'Поле';
      const label = document.createElement('input'); label.className = 'compare-label'; label.value = field.targetLabel || field.label || '';
      const status = document.createElement('select'); status.className = 'compare-status';
      Object.entries(TRANSLATION_STATUSES).forEach(([value, [text]]) => {
        const option = el('option', text); option.value = value; option.selected = field.translationStatus === value; status.append(option);
      });
      const remove = button('Удалить'); remove.className = 'btn-secondary compare-delete';
      fieldCell.append(label);
      const original = document.createElement('textarea'); original.className = 'compare-original'; original.value = field.value || '';
      const translated = document.createElement('textarea'); translated.className = 'compare-translated'; translated.value = field.translated || '';
      const sourceCell = el('td'); sourceCell.append(original);
      sourceCell.dataset.label = 'Оригинал';
      const translatedCell = el('td'); translatedCell.append(translated);
      translatedCell.dataset.label = 'Перевод';
      const typeCell = el('td', null, 'compare-type-cell');
      typeCell.dataset.label = 'Тип обработки';
      [[label, 'Название поля'], [original, 'Оригинал'], [translated, 'Перевод'], [status, 'Тип обработки']].forEach(([control, text]) => {
        control.setAttribute('aria-label', `${text}: ${field.targetLabel || field.label || ''}`);
      });
      typeCell.append(status, remove);
      if (field.requiresReview) {
        sourceCell.append(el('div', field.reviewReason, 'admin-error'));
        if (field.verificationCandidate) sourceCell.append(el('div', `Повторное чтение: ${field.verificationCandidate}`, 'admin-note'));
        const review = document.createElement('input'); review.type = 'checkbox'; review.className = 'compare-reviewed';
        review.checked = field.reviewedSource === field.value && field.reviewedTranslation === field.translated;
        const reviewLabel = el('label', ' Сверено с оригиналом'); reviewLabel.prepend(review);
        typeCell.append(reviewLabel);
        [original, translated].forEach(input => input.addEventListener('input', () => { review.checked = false; }));
        remove.disabled = true;
      }
      row.append(fieldCell, sourceCell, translatedCell, typeCell);
      remove.addEventListener('click', () => { row.remove(); sync(); });
      return row;
    };
    doc.result.fields.filter(field => field.value || field.translated || field.requiresReview).forEach(field => tbody.append(makeRow(field)));

    // "Другое"/клиентские типы несут остальную структуру документа в
    // paragraphs, не в fields (см. lib/translationDocs/pipeline.js,
    // 17 сен 2026) — отдельная редактируемая таблица ниже; у табличных
    // типов paragraphs пуст, секция просто не создаётся. Пустой textarea
    // "Оригинал" исключает абзац из парного экспорта (pairedLayoutBlocks
    // фильтрует по непустому original) — так клиент может убрать лишний
    // абзац, не трогая остальные и не нужен отдельный "Удалить".
    let paraTable = null;
    let paraHeading = null;
    if (Array.isArray(doc.result.paragraphs) && doc.result.paragraphs.length) {
      paraHeading = el('h4', 'Полный текст документа'); paraHeading.style.margin = '18px 0 8px';
      paraTable = el('table', null, 'admin-table translation-compare-table');
      paraTable.innerHTML = '<thead><tr><th>Оригинал</th><th>Перевод</th></tr></thead>';
      const paraBody = el('tbody');
      doc.result.paragraphs.forEach((p, i) => {
        const row = el('tr'); row.dataset.index = String(i);
        const original = document.createElement('textarea'); original.className = 'compare-original'; original.value = p.text || '';
        const translated = document.createElement('textarea'); translated.className = 'compare-translated'; translated.value = p.translated || '';
        original.setAttribute('aria-label', `Оригинал, абзац ${i + 1}`);
        translated.setAttribute('aria-label', `Перевод, абзац ${i + 1}`);
        const sourceCell = el('td'); sourceCell.append(original); sourceCell.dataset.label = 'Оригинал';
        const translatedCell = el('td'); translatedCell.append(translated); translatedCell.dataset.label = 'Перевод';
        row.append(sourceCell, translatedCell);
        paraBody.append(row);
      });
      paraTable.append(paraBody);
    }
    // Таблицы предметов/оценок (Аттестат и т.п.) — редактирование строк тоже
    // часть общего compare/save механизма, не отдельный формат сохранения:
    // subject/grade/translatedSubject/translatedGrade правятся тут же,
    // "Добавить строку"/"Удалить" меняют состав, а на "Сохранить изменения"
    // doc.result.tables перестраивается из DOM (см. sync() ниже) и уходит в
    // renderSubjectTables — тот же приём, что уже используется для
    // fields/paragraphs выше. Сохранения на сервер нет и для них: как и
    // fields/paragraphs, это только состояние вкладки, используемое при
    // экспорте (buildExportDocs читает doc.result.tables заново на каждый
    // клик "Скачать").
    const tableSections = [];
    if (Array.isArray(doc.result.tables) && doc.result.tables.length) {
      doc.result.tables.forEach((tbl, tableIndex) => {
        const tHeading = el('h4', tbl.section || 'Предметы и оценки'); tHeading.style.margin = '18px 0 8px';
        const tTable = el('table', null, 'admin-table translation-compare-table');
        tTable.innerHTML = '<thead><tr><th>Предмет</th><th>Оценка</th><th>Перевод предмета</th><th>Перевод оценки</th><th></th></tr></thead>';
        const tBody = el('tbody');
        const makeTableRow = (row = {}) => {
          const tr = el('tr');
          const cells = [
            ['compare-table-subject', 'Предмет', row.subject],
            ['compare-table-grade', 'Оценка', row.grade],
            ['compare-table-translated-subject', 'Перевод предмета', row.translatedSubject],
            ['compare-table-translated-grade', 'Перевод оценки', row.translatedGrade]
          ].map(([cls, labelText, value]) => {
            const input = document.createElement('input'); input.className = cls; input.value = value || '';
            input.setAttribute('aria-label', `${labelText}: ${tbl.section || 'Предметы и оценки'}`);
            const td = el('td'); td.dataset.label = labelText; td.append(input);
            return td;
          });
          const removeCell = el('td');
          const remove = button('Удалить'); remove.className = 'btn-secondary compare-delete';
          remove.addEventListener('click', () => tr.remove());
          removeCell.append(remove);
          tr.append(...cells, removeCell);
          return tr;
        };
        (tbl.rows || []).forEach(row => tBody.append(makeTableRow(row)));
        tTable.append(tBody);
        const addRow = button('Добавить строку'); addRow.className = 'btn-secondary';
        addRow.style.margin = '8px 0 0';
        addRow.addEventListener('click', () => {
          const tr = makeTableRow();
          tBody.append(tr);
          tr.querySelector('.compare-table-subject').focus();
        });
        tableSections.push({ tHeading, tTable, addRow, tBody, tableIndex });
      });
    }
    const saveStatus = el('div', null, 'translation-compare-save-status');
    saveStatus.setAttribute('role', 'status');
    saveStatus.setAttribute('aria-live', 'polite');
    const toolbar = el('div', null, 'translation-compare-toolbar translation-compare-toolbar-bottom');
    const add = button('Добавить поле');
    const save = button('Сохранить изменения', 'btn-primary');
    toolbar.append(add, save, saveStatus);

    const sync = async () => {
      // Hidden empty headings are part of the legal structure, not deleted rows.
      const fields = doc.result.fields.filter(field => !field.value && !field.translated && !field.requiresReview);
      const glossaryEntries = [];
      tbody.querySelectorAll('tr').forEach(row => {
        const field = doc.result.fields.find(item => item.key === row.dataset.key);
        if (!field) return;
        field.targetLabel = row.querySelector('.compare-label').value.trim() || 'Новое поле';
        field.value = row.querySelector('.compare-original').value;
        field.translated = row.querySelector('.compare-translated').value;
        field.translationStatus = row.querySelector('.compare-status').value;
        if (field.requiresReview) {
          field.reviewedSource = row.querySelector('.compare-reviewed')?.checked ? field.value : undefined;
          field.reviewedTranslation = row.querySelector('.compare-reviewed')?.checked ? field.translated : undefined;
        }
        // Клиент подтвердил (или сам поправил) транслитерацию имени/места —
        // отправляем в глоссарий (lib/verifiedTransliterations.js): личный
        // выбор клиента, плюс пересчёт общего дефолта по большинству. Не
        // блокирует сохранение — тот же fire-and-forget приём, что раньше
        // был у public/js/translation/panel.js:confirmNameOverrides.
        if (field.translationStatus === 'transliterated' && field.value.trim() && field.translated.trim()) {
          glossaryEntries.push({ original: field.value, verifiedValue: field.translated });
        }
        fields.push(field);
      });
      doc.result.fields = fields;
      renderFieldsTable(doc.result.fields);
      if (paraTable) {
        paraTable.querySelectorAll('tbody tr').forEach(row => {
          const p = doc.result.paragraphs[Number(row.dataset.index)];
          if (!p) return;
          p.text = row.querySelector('.compare-original').value;
          p.translated = row.querySelector('.compare-translated').value;
        });
        renderParagraphsTable(doc.result.paragraphs);
      }
      if (tableSections.length) {
        doc.result.tables = tableSections.map(({ tBody, tableIndex }) => ({
          section: doc.result.tables[tableIndex]?.section,
          rows: Array.from(tBody.querySelectorAll('tr')).map(row => ({
            subject: row.querySelector('.compare-table-subject').value,
            grade: row.querySelector('.compare-table-grade').value,
            translatedSubject: row.querySelector('.compare-table-translated-subject').value,
            translatedGrade: row.querySelector('.compare-table-translated-grade').value
          })).filter(row => row.subject.trim() || row.grade.trim() || row.translatedSubject.trim() || row.translatedGrade.trim())
        }));
        renderSubjectTables(doc.result.tables);
      }
      let glossarySaved = true;
      if (glossaryEntries.length) {
        const token = getClientToken();
        try {
          const response = await fetch('/api/transliterations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'x-client-token': token } : {}) },
            body: JSON.stringify({ action: 'confirm', clientSlug: getClientSlug(), entries: glossaryEntries })
          });
          glossarySaved = response.ok;
        } catch (_) {
          glossarySaved = false;
        }
      }
      saveStatus.textContent = glossarySaved ? 'Изменения сохранены' : 'Изменения сохранены, но глоссарий не обновился';
      saveStatus.classList.toggle('is-error', !glossarySaved);
    };
    save.addEventListener('click', async () => {
      save.disabled = true;
      saveStatus.textContent = 'Сохраняем…';
      saveStatus.classList.remove('is-error');
      try {
        await sync();
      } finally {
        save.disabled = false;
      }
    });
    add.addEventListener('click', () => {
      const key = `custom_${Date.now()}`;
      const field = { key, label: 'Новое поле', targetLabel: 'Новое поле', value: '', translated: '', translationStatus: 'translated', confidence: 100 };
      doc.result.fields.push(field);
      const row = makeRow(field);
      tbody.append(row);
      row.querySelector('.compare-label').focus();
    });
    close.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    dialog.append(header, table, ...(paraTable ? [paraHeading, paraTable] : []), ...tableSections.flatMap(({ tHeading, tTable, addRow }) => [tHeading, tTable, addRow]), toolbar);
    modal.append(dialog);
    root.append(modal);
  });
}
