// public/js/accounting/panel.js — клиентская веб-панель модуля бухгалтерии
// (Ethan, 15 сен 2026: "добавить модуль бухгалтерии для платных клиентов").
// По образцу public/js/translation/panel.js: весь DOM строится в JS и
// добавляется в страницу, панель показывается ТОЛЬКО если у клиента есть
// slug И валидный x-client-token (тот же критерий "платный клиент с
// паролем", что уже используют translation/panel.js и requirePaidAccountingClient
// на сервере — см. lib/accounting/clientAccess.js).
//
// В отличие от перевода (который работает с уже распознанными документами
// основного OCR-потока), бухгалтерия — СВОЙ отдельный поток загрузки/
// распознавания, как review-экран public/admin/accounting.js, поэтому здесь
// переиспользуются его DOM-агностичные модули (render.js/fileQueue.js/
// labels.js принимают элементы/данные параметрами — ничего не знают про
// admin-секрет), только сетевой слой и гейт свои — под клиентский токен, не
// под x-admin-secret.
import { getClientSlug, getClientToken } from '../branding.js';
import { DOC_TYPE_LABELS } from '../../admin/accounting/labels.js';
import { renderFileList, renderPreview, renderHeaderTable, renderItemsTable, renderRules } from '../../admin/accounting/render.js';
import { createDocsFromFiles, fileToBase64 } from '../../admin/accounting/fileQueue.js';

async function recognizeViaApi(token, slug, base64, mimeType) {
  const res = await fetch('/api/accounting/client-recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-token': token },
    body: JSON.stringify({ image: base64, mimeType, clientSlug: slug })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
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
    throw new Error(data.error || `Ошибка ${res.status}`);
  }
  return res.blob();
}

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (text, cls = 'btn-secondary') => { const b = el('button', text, cls); b.type = 'button'; return b; };

export async function initAccounting() {
  const slug = getClientSlug(), token = getClientToken();
  if (!slug || !token) return; // не платный клиент с паролем — панель не показываем, как и перевод

  const root = el('section', null, 'panel acct-wrap');
  root.id = 'accountingPanel';

  const header = el('div', null, 'step-label');
  header.textContent = 'Модуль бухгалтерии';
  root.append(header);
  root.append(el('div', 'ЭСФ, товарная накладная, акт выполненных работ, платёжное поручение — распознавание и проверка по бухгалтерским правилам. Расходует тот же пакет страниц, что и обычное распознавание.', 'admin-note'));

  const fileLabel = el('label', 'Выбрать файлы', 'btn-secondary acct-file-label');
  const fileInput = el('input'); fileInput.type = 'file'; fileInput.id = 'acctFileInput';
  fileInput.accept = 'image/png,image/jpeg,image/webp,application/pdf'; fileInput.multiple = true;
  fileInput.className = 'acct-file-input';
  fileLabel.htmlFor = 'acctFileInput';
  root.append(fileLabel, fileInput);

  const fileListEl = el('div', null, 'acct-file-list'); fileListEl.style.display = 'none';
  root.append(fileListEl);

  const recognizeBtn = button('Распознать', 'btn-primary');
  recognizeBtn.style.marginTop = '12px';
  recognizeBtn.disabled = true;
  root.append(recognizeBtn);

  const acctError = el('div', null, 'admin-error'); acctError.style.display = 'none';
  const acctLoading = el('div', null, 'admin-note'); acctLoading.style.display = 'none';
  root.append(acctError, acctLoading);

  const resultPanel = el('section'); resultPanel.style.display = 'none';
  const columns = el('div', null, 'acct-columns');

  const colOriginal = el('div', null, 'panel acct-col-original');
  colOriginal.append(el('div', 'Оригинал', 'step-label'));
  const previewBox = el('div');
  colOriginal.append(previewBox);

  const colFields = el('div', null, 'panel acct-col-fields');
  const statusRow = el('div', null, 'acct-status-row');
  const docTypeLabel = el('div', 'Документ', 'step-label'); docTypeLabel.style.margin = '0';
  const overallBadge = el('span', null, 'acct-badge');
  statusRow.append(docTypeLabel, overallBadge);
  colFields.append(statusRow);

  const exportBtn = button('Скачать Excel'); exportBtn.style.marginBottom = '14px'; exportBtn.disabled = true;
  const exportError = el('div', null, 'admin-error'); exportError.style.display = 'none';
  colFields.append(exportBtn, exportError);

  const headerTable = el('table', null, 'admin-table acct-header-table');
  colFields.append(headerTable);

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
  colFields.append(itemsSectionTitle, itemsSection);

  colFields.append(el('div', 'Проверки', 'admin-section-title'));
  const rulesList = el('div', null, 'acct-rules-list');
  colFields.append(rulesList);

  columns.append(colOriginal, colFields);
  resultPanel.append(columns);
  root.append(resultPanel);

  const appRoot = document.getElementById('appRoot');
  const footer = appRoot ? appRoot.querySelector('footer') : null;
  if (footer) footer.before(root); else (appRoot || document.body).append(root);

  // --- состояние и обработчики (см. public/admin/accounting.js — тот же
  // поток, только сеть/гейт под клиентский токен) -----------------------
  let docs = [];
  let activeIndex = -1;

  function refreshFileList() { renderFileList(fileListEl, docs, activeIndex, selectDoc); }

  fileInput.addEventListener('change', () => {
    if (!fileInput.files || !fileInput.files.length) return;
    docs = createDocsFromFiles(fileInput.files);
    activeIndex = -1;
    resultPanel.style.display = 'none';
    exportBtn.disabled = true;
    acctError.style.display = 'none';
    refreshFileList();
    recognizeBtn.disabled = false;
  });

  async function selectDoc(index) {
    const doc = docs[index];
    if (!doc) return;
    activeIndex = index;
    refreshFileList();

    const base64 = await fileToBase64(doc.file);
    renderPreview(previewBox, doc.file.type, base64);

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
      const base64 = await fileToBase64(doc.file);
      const data = await recognizeViaApi(token, slug, base64, doc.file.type);
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
    acctLoading.style.display = '';

    // Последовательно, не параллельно — тот же приём, что у review-экрана
    // (Gemini free tier ~20 запросов/мин, см. ways-of-working.md).
    const pending = docs.map((doc, index) => ({ doc, index })).filter(({ doc }) => doc.status === 'pending' || doc.status === 'error');
    let firstDoneIndex = -1;
    let anyError = false;

    for (const { doc, index } of pending) {
      acctLoading.textContent = `Распознаём ${index + 1} из ${docs.length}...`;
      await recognizeOne(doc);
      if (doc.status === 'done' && firstDoneIndex === -1) firstDoneIndex = index;
      if (doc.status === 'error') anyError = true;
    }

    acctLoading.style.display = 'none';
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
    exportBtn.textContent = 'Формируем файл...';
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
      exportBtn.textContent = 'Скачать Excel';
    }
  });
}
