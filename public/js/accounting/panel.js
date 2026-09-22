// public/js/accounting/panel.js — клиентская веб-панель модуля бухгалтерии
// (Ethan, 15 сен 2026: "добавить модуль бухгалтерии для платных клиентов";
// 16 сен 2026: "табы сверху блока, общий проход по полировке UI" — вместо
// панели, свалившейся ниже результатов обычного распознавания).
//
// По образцу public/js/translation/panel.js: весь DOM строится в JS и
// добавляется в страницу, панель показывается ТОЛЬКО если у клиента есть
// slug И валидный x-client-token (тот же критерий "платный клиент с
// паролем", что уже используют translation/panel.js и requirePaidAccountingClient
// на сервере — см. lib/accounting/clientAccess.js).
//
// Структура страницы (16 сен 2026): #recognizeFlow в index.html оборачивает
// ВЕСЬ поток обычного распознавания (загрузка/прогресс/результаты) —
// переключатель табов над ним строит общий контроллер
// public/js/contentTabs.js (registerTab), который показывает ровно одну
// вкладку за раз и с этой же даты умеет больше двух — см. там же
// public/js/translationDocs/panel.js, зарегистрировавший третью вкладку
// "Перевод". Сайт остаётся однoколоночным (max-width:720px, тот же
// контейнер, что у results/translation-panel) — Ethan подтвердил табы
// сверху вместо боковой вкладки, т.к. настоящий боковой рельс потребовал бы
// отдельной мобильной раскладки.
//
// Бухгалтерия — СВОЙ отдельный поток загрузки/распознавания, как
// review-экран public/admin/accounting.js, поэтому здесь переиспользуются
// его DOM-агностичные модули (render.js/fileQueue.js/labels.js принимают
// элементы/данные параметрами — ничего не знают про admin-секрет), только
// сетевой слой и гейт свои — под клиентский токен, не под x-admin-secret.
import { getClientSlug, getClientToken, touchClientSession } from '../branding.js';
import { registerTab } from '../contentTabs.js';
import { DOC_TYPE_LABELS } from '../../admin/accounting/labels.js';
import { renderFileList, renderPreview, renderHeaderTable, renderItemsTable, renderRules } from '../../admin/accounting/render.js';
import { createDocsFromFiles, fileToBase64 } from '../../admin/accounting/fileQueue.js';
import { runWithConcurrency } from '../utils/concurrencyPool.js';
import { fixPdfRotation } from '../ocr/pdfRotationFix.js';

const MAX_ACCOUNTING_CONCURRENCY = 20;

// Сканы/фото PDF иногда сняты боком (см. ocr/pdfRotationFix.js) — проверяем и
// правим один раз на файл, дальше и превью, и сама отправка на распознавание
// используют один и тот же (уже поправленный) файл. Кэшируем на самом doc,
// чтобы не гонять проверку повторно при каждом клике по файлу в списке.
async function getUploadFile(doc) {
  if (!doc.__uploadFile) doc.__uploadFile = await fixPdfRotation(doc.file);
  return doc.__uploadFile;
}

async function recognizeViaApi(token, slug, base64, mimeType) {
  touchClientSession(); // продлевает сессию во время долгой автоматической обработки без кликов — см. branding.js
  const res = await fetch('/api/accounting/client-recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-token': token },
    body: JSON.stringify({ image: base64, mimeType, clientSlug: slug })
  });
  const data = await res.json();
  if (!res.ok) {
    const messages = {
      QUOTA_EXCEEDED: 'Лимит страниц по вашему тарифу исчерпан.',
      QUOTA_UNAVAILABLE: 'Сервис учёта лимита временно недоступен. Повторите попытку позже.',
      INVALID_DOCUMENT: 'Не удалось определить документ. Загрузите более чёткий скан.',
      INVALID_FILE: 'Файл имеет неподдерживаемый формат.'
    };
    throw new Error(messages[data.code] || data.error || `Не удалось обработать документ (код ${res.status}).`);
  }
  return data;
}

async function exportViaApi(token, slug, documents) {
  const res = await fetch('/api/accounting/client-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-token': token },
    body: JSON.stringify({ clientSlug: slug, documents })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Не удалось скачать Excel-файл (код ${res.status}).`);
  }
  return res.blob();
}

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (text, cls = 'btn-secondary') => { const b = el('button', text, cls); b.type = 'button'; return b; };
const svg = (paths, viewBox = '0 0 20 20') => {
  const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wrap.setAttribute('viewBox', viewBox);
  wrap.setAttribute('fill', 'none');
  wrap.setAttribute('stroke', 'currentColor');
  wrap.setAttribute('stroke-width', '1.6');
  wrap.setAttribute('stroke-linecap', 'round');
  wrap.setAttribute('stroke-linejoin', 'round');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = paths;
  return wrap;
};

// Иконка «документ с галочкой» — визуально в той же стилистике, что
// translation-icon (см. public/css/translation.css): скруглённый квадрат
// с акцентным фоном, внутри — линейная иконка тем же stroke-width/линиями,
// что svg-иконки экспорта на главной странице (index.html:downloadXlsxBtn
// и т.п.), а не новый набор произвольных иконок.
function panelIcon() {
  const box = el('span', null, 'acct-panel-icon');
  const icon = svg('<path d="M6 2.5h6l4 4v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"/><path d="M12 2.5v4h4"/><path d="M7.5 12.5l1.8 1.8L13.5 10"/>', '0 0 20 20');
  icon.setAttribute('width', '16'); icon.setAttribute('height', '16');
  box.append(icon);
  return box;
}

function excelIcon() {
  const icon = svg('<rect x="2.5" y="3" width="15" height="14" rx="1"/><line x1="2.5" y1="8" x2="17.5" y2="8"/><line x1="2.5" y1="13" x2="17.5" y2="13"/><line x1="8" y1="3" x2="8" y2="17"/><line x1="13" y1="3" x2="13" y2="17"/>', '0 0 20 20');
  icon.setAttribute('width', '16'); icon.setAttribute('height', '16');
  icon.setAttribute('stroke-width', '1.5');
  icon.classList.add('btn-icon');
  return icon;
}

export async function initAccounting() {
  const slug = getClientSlug(), token = getClientToken();
  if (!slug || !token) return; // не платный клиент с паролем — вкладка не показывается, как и перевод

  // --- корневой блок панели + регистрация вкладки "Бухгалтерия" -----------
  // (общий таб-контроллер вынесен в public/js/contentTabs.js 16 сен 2026,
  // когда добавился модуль "Перевод" — раньше таб-бар строился прямо
  // здесь и умел показывать только эти две вкладки.)
  const root = el('section', null, 'panel acct-wrap acct-accounting-wrap');
  root.id = 'accountingPanel';

  const panelHeader = el('div', null, 'acct-panel-header');
  const panelTitle = el('div', null, 'acct-panel-header-title');
  panelTitle.append(panelIcon(), el('h2', 'Модуль бухгалтерии'));
  panelHeader.append(panelTitle);
  root.append(panelHeader);
  root.append(el('p', 'ЭСФ, товарная накладная, акт выполненных работ, платёжное поручение — распознавание и проверка по бухгалтерским правилам. Расходует тот же пакет страниц, что и обычное распознавание.', 'admin-note'));

  if (!registerTab('accounting', 'Бухгалтерия', root)) return; // защитно — без #recognizeFlow регистрировать нечего

  // --- загрузка файлов — тот же .dropzone, что на главном экране (styles.css),
  // с drag&drop, вместо голой кнопки выбора файла. -------------------------
  const dropzone = el('label', null, 'dropzone');
  dropzone.append(el('div', '📄', 'icon'), el('div', 'Нажмите здесь или перетащите файл', 'main'), el('div', 'Фото, скан или PDF — можно сразу несколько', 'sub'));
  const fileInput = el('input'); fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/webp,application/pdf'; fileInput.multiple = true;
  dropzone.append(fileInput);
  root.append(dropzone);

  const fileListEl = el('div', null, 'acct-file-list'); fileListEl.style.display = 'none';
  const originalPanel = el('div', null, 'panel acct-col-original');
  originalPanel.style.display = 'none';
  originalPanel.append(el('div', 'Оригинал', 'step-label'));
  const previewBox = el('div');
  originalPanel.append(previewBox);
  const fileWorkspace = el('div', null, 'acct-accounting-workspace');
  fileWorkspace.append(fileListEl, originalPanel);
  root.append(fileWorkspace);

  const recognizeBtn = button('Распознать', 'btn-primary');
  recognizeBtn.classList.add('acct-recognize-btn');
  recognizeBtn.disabled = true;
  root.append(recognizeBtn);

  // Тот же приём, что в public/js/translationDocs/panel.js (Ethan, 19 сен
  // 2026: "убрать документ из списка / очистить весь список") — кнопка
  // удаления отдельного документа рисуется в самом списке
  // (renderFileList/onRemove ниже), эта — единая кнопка сброса всего сразу.
  const clearAllBtn = button('Очистить список');
  clearAllBtn.style.display = 'none';
  root.append(clearAllBtn);

  const acctError = el('div', null, 'admin-error'); acctError.style.display = 'none';

  // Прогресс пачки — тот же .progress-track/.progress-fill, что у обычного
  // распознавания (styles.css), вместо голой строки текста "Распознаём N из M".
  const progressWrap = el('div'); progressWrap.style.display = 'none'; progressWrap.style.marginTop = '10px';
  const progressText = el('div', null, 'admin-note');
  const progressTrack = el('div', null, 'progress-track');
  const progressFill = el('div', null, 'progress-fill');
  progressTrack.append(progressFill);
  progressWrap.append(progressText, progressTrack);
  root.append(acctError, progressWrap);

  const resultPanel = el('section', null, 'panel acct-col-fields'); resultPanel.style.display = 'none';
  const statusRow = el('div', null, 'acct-status-row');
  const docTypeLabel = el('div', 'Документ', 'step-label'); docTypeLabel.style.margin = '0';
  const overallBadge = el('span', null, 'acct-badge');
  statusRow.append(docTypeLabel, overallBadge);
  resultPanel.append(statusRow);

  const exportBtn = button('Скачать Excel'); exportBtn.style.marginBottom = '14px'; exportBtn.disabled = true;
  exportBtn.prepend(excelIcon());
  const exportError = el('div', null, 'admin-error'); exportError.style.display = 'none';
  resultPanel.append(exportBtn, exportError);

  const headerTable = el('table', null, 'admin-table acct-header-table');
  resultPanel.append(headerTable);

  const itemsSectionTitle = el('div', 'Строки', 'admin-section-title');
  const itemsSection = el('div', null, 'acct-table-scroll');
  const itemsTable = el('table', null, 'admin-table'); itemsTable.id = 'acctItemsTable';
  const thead = el('thead');
  const headRow = el('tr');
  ['Наименование', 'Кол-во', 'Цена', 'Сумма', 'Ставка НДС', 'Сумма НДС'].forEach(t => headRow.append(el('th', t)));
  thead.append(headRow);
  const itemsBody = el('tbody');
  itemsTable.append(thead, itemsBody);
  itemsSection.append(itemsTable);
  resultPanel.append(itemsSectionTitle, itemsSection);

  resultPanel.append(el('div', 'Проверки', 'admin-section-title'));
  const rulesList = el('div', null, 'acct-rules-list');
  resultPanel.append(rulesList);

  root.append(resultPanel);

  // --- состояние и обработчики (см. public/admin/accounting.js — тот же
  // поток, только сеть/гейт под клиентский токен, плюс drag&drop и прогресс-
  // бар вместо голого текста) -----------------------------------------------
  let docs = [];
  let activeIndex = -1;

  function refreshFileList() {
    renderFileList(fileListEl, docs, activeIndex, selectDoc, removeDoc);
    clearAllBtn.style.display = docs.length ? '' : 'none';
  }

  // Тот же баг и тот же фикс, что и в public/js/translationDocs/panel.js
  // (Ethan, 19 сен 2026: второй выбор файла стирал уже добавленные) — docs
  // раньше ПЕРЕЗАПИСЫВАЛСЯ, теперь новые файлы ДОБАВЛЯЮТСЯ к списку; уже
  // выбранный/распознанный документ не сбрасывается повторной загрузкой.
  function loadFiles(fileList) {
    if (!fileList || !fileList.length) return;
    docs = docs.concat(createDocsFromFiles(fileList));
    acctError.style.display = 'none';
    refreshFileList();
    recognizeBtn.disabled = false;
  }

  function deselectActive() {
    activeIndex = -1;
    resultPanel.style.display = 'none';
    originalPanel.style.display = 'none';
  }

  // Ethan, 19 сен 2026: "чтобы человек мог убрать какой-то документ из
  // списка" — тот же приём, что в translationDocs/panel.js. exportBtn
  // экспортирует ВСЕ распознанные документы разом (не только активный),
  // поэтому его состояние пересчитывается по остатку docs, а не просто
  // блокируется.
  function removeDoc(index) {
    if (index < 0 || index >= docs.length) return;
    const wasActive = index === activeIndex;
    docs.splice(index, 1);
    if (wasActive) {
      deselectActive();
    } else if (index < activeIndex) {
      activeIndex -= 1;
    }
    acctError.style.display = 'none';
    refreshFileList();
    recognizeBtn.disabled = !docs.length;
    exportBtn.disabled = !docs.some(d => d.status === 'done');
  }

  // "и одна кнопка которая очищает весь список" — сброс всего сразу.
  function clearAll() {
    if (!docs.length) return;
    docs = [];
    deselectActive();
    acctError.style.display = 'none';
    refreshFileList();
    recognizeBtn.disabled = true;
    exportBtn.disabled = true;
  }
  clearAllBtn.addEventListener('click', clearAll);

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

  async function selectDoc(index) {
    const doc = docs[index];
    if (!doc) return;
    activeIndex = index;
    refreshFileList();

    const uploadFile = await getUploadFile(doc);
    const base64 = await fileToBase64(uploadFile);
    renderPreview(previewBox, uploadFile.type, base64);
    originalPanel.style.display = '';

    if (doc.status !== 'done' || !doc.result) {
      resultPanel.style.display = 'none';
      return;
    }
    const data = doc.result;
    overallBadge.textContent = data.overall_status;
    overallBadge.className = `acct-badge acct-badge-${data.overall_status}`;
    docTypeLabel.textContent = DOC_TYPE_LABELS[data.doc_type] || data.doc_type;
    renderHeaderTable(headerTable, data.header);
    renderItemsTable(itemsBody, itemsSection, itemsSectionTitle, data.items);
    renderRules(rulesList, data.validation);
    resultPanel.style.display = '';
  }

  async function recognizeOne(doc) {
    doc.status = 'recognizing';
    doc.error = null;
    refreshFileList();
    try {
      const uploadFile = await getUploadFile(doc);
      const base64 = await fileToBase64(uploadFile);
      const data = await recognizeViaApi(token, slug, base64, uploadFile.type);
      doc.status = 'done';
      doc.result = { ...data, file_name: doc.file.name };
    } catch (err) {
      doc.status = 'error';
      doc.error = err.message || 'Не удалось распознать документ';
    }
    refreshFileList();
  }

  recognizeBtn.addEventListener('click', async () => {
    if (!docs.length) return;
    acctError.style.display = 'none';
    recognizeBtn.disabled = true;
    exportBtn.disabled = true;
    progressWrap.style.display = '';
    progressFill.style.width = '0%';

    const pending = docs.map((doc, index) => ({ doc, index })).filter(({ doc }) => doc.status === 'pending' || doc.status === 'error');
    let firstDoneIndex = -1;
    let anyError = false;
    let done = 0;

    // Документы обрабатываются параллельно, но не более 20 одновременно.
    // recognizeOne перехватывает ошибку каждого документа, поэтому сбой
    // одного запроса не останавливает остальные задачи пула.
    await runWithConcurrency(pending, MAX_ACCOUNTING_CONCURRENCY, async ({ doc, index }) => {
      progressText.textContent = `Распознаём ${done + 1} из ${pending.length}...`;
      await recognizeOne(doc);
      done += 1;
      progressFill.style.width = `${Math.round((done / pending.length) * 100)}%`;
      if (doc.status === 'done' && firstDoneIndex === -1) firstDoneIndex = index;
      if (doc.status === 'error') anyError = true;
    });

    progressWrap.style.display = 'none';
    recognizeBtn.disabled = false;
    exportBtn.disabled = !docs.some(d => d.status === 'done');
    if (anyError) {
      const errored = docs.filter(d => d.status === 'error').length;
      acctError.textContent = `Не удалось распознать ${errored} из ${docs.length} файлов — см. статус в списке файлов.`;
      acctError.style.display = '';
    }

    const showIndex = firstDoneIndex !== -1 ? firstDoneIndex : (docs.length ? 0 : -1);
    if (showIndex !== -1) await selectDoc(showIndex);
  });

  exportBtn.addEventListener('click', async () => {
    const done = docs.filter(d => d.status === 'done');
    if (!done.length) return;
    exportError.style.display = 'none';
    exportBtn.disabled = true;
    const originalLabel = exportBtn.lastChild;
    exportBtn.lastChild.textContent = 'Формируем файл...';
    try {
      const blob = await exportViaApi(token, slug, done.map(d => d.result));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = done.length === 1
        ? `${(done[0].result.file_name || 'export').replace(/\.[^.]+$/, '')}.xlsx`
        : `accounting-export-${done.length}-docs.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      exportError.textContent = err.message || 'Не удалось скачать файл';
      exportError.style.display = '';
    } finally {
      exportBtn.disabled = !docs.some(d => d.status === 'done');
      originalLabel.textContent = 'Скачать Excel';
    }
  });
}
