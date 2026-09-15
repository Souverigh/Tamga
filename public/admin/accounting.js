// public/admin/accounting.js — review-экран модуля бухгалтерии (§19 хендовера).
// Гейт переиспользует ТОТ ЖЕ секрет/сессию, что public/admin/admin.js
// (SECRET_KEY='tamga_admin_secret', createIdleSession из ../js/idleSession.js) —
// одна и та же admin-сессия открывает обе страницы, второй логин не нужен.
//
// Разбито на модули 15 сен 2026 (Ethan: "хранить всё в одном HTML/файле —
// это неправильно, разделить на модульные сегменты, которые можно
// переиспользовать, масштабировать") — вынесено в public/admin/accounting/:
// labels.js (словари подписей), api.js (сетевой слой), render.js
// (DOM-рендеринг), fileQueue.js (batch-состояние файлов). Разбивка ТОЛЬКО
// внутри бухгалтерского модуля — Ethan подтвердил не трогать код вне него
// (admin.html/admin.js не задеты), без сборщика — нативные ES-модули, как
// уже было с ../js/idleSession.js. Этот файл — тонкий оркестратор: DOM
// ссылки, состояние страницы, обработчики событий, вызовы модулей.

import { createIdleSession } from '../js/idleSession.js';
import { DOC_TYPE_LABELS } from './accounting/labels.js';
import { recognizeDocument, exportDocuments } from './accounting/api.js';
import { renderFileList, renderPreview, renderHeaderTable, renderItemsTable, renderRules } from './accounting/render.js';
import { createDocsFromFiles, fileToBase64 } from './accounting/fileQueue.js';

const SECRET_KEY = 'tamga_admin_secret';
const session = createIdleSession(SECRET_KEY);

const gate = document.getElementById('gate');
const gateBtn = document.getElementById('gateBtn');
const secretInput = document.getElementById('secretInput');
const gateError = document.getElementById('gateError');
const acctMain = document.getElementById('acctMain');

const fileInput = document.getElementById('fileInput');
const fileListEl = document.getElementById('fileList');
const recognizeBtn = document.getElementById('recognizeBtn');
const acctError = document.getElementById('acctError');
const acctLoading = document.getElementById('acctLoading');
const resultPanel = document.getElementById('resultPanel');
const previewBox = document.getElementById('previewBox');
const overallBadge = document.getElementById('overallBadge');
const docTypeLabel = document.getElementById('docTypeLabel');
const exportBtn = document.getElementById('exportBtn');
const exportError = document.getElementById('exportError');
const headerTable = document.getElementById('headerTable');
const itemsBody = document.getElementById('itemsBody');
const itemsSection = document.getElementById('itemsSection');
const itemsSectionTitle = document.getElementById('itemsSectionTitle');
const rulesList = document.getElementById('rulesList');

// Bulk-загрузка (15 сен 2026, §18 хендовера) — Ethan подтвердил: каждый
// файл независимый документ, без сверки между ними. См. fileQueue.js для
// формы элементов docs[]. base64 не кэшируется на весь батч заранее —
// считается по одному прямо перед отправкой на распознавание (и повторно
// при показе превью того же файла), чтобы не держать в памяти все файлы
// сразу в base64 одновременно.
let docs = [];
let activeIndex = -1;

function showGate() {
  gate.style.display = '';
  acctMain.style.display = 'none';
}

function showMain() {
  gate.style.display = 'none';
  acctMain.style.display = '';
}

gateBtn.addEventListener('click', () => {
  const value = secretInput.value.trim();
  if (!value) return;
  session.set(value);
  gateError.style.display = 'none';
  showMain();
});

function refreshFileList() {
  renderFileList(fileListEl, docs, activeIndex, selectDoc);
}

fileInput.addEventListener('change', () => {
  if (!fileInput.files || !fileInput.files.length) return;
  // Новый выбор файлов ЗАМЕНЯЕТ предыдущий батч (а не добавляет к нему) —
  // самое предсказуемое поведение для input[type=file], без отдельного
  // UI "добавить ещё"/"очистить список" в этом первом срезе.
  docs = createDocsFromFiles(fileInput.files);
  activeIndex = -1;
  resultPanel.style.display = 'none';
  exportBtn.disabled = true;
  acctError.style.display = 'none';
  refreshFileList();
  recognizeBtn.disabled = false;
});

// Показывает документ по индексу в правой/левой колонках (превью + поля +
// проверки) — общая функция для клика по строке списка и для показа только
// что распознанного документа сразу после recognize.
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
    const data = await recognizeDocument(session.get(), base64, doc.file.type);
    doc.status = 'done';
    doc.result = { ...data, file_name: doc.file.name };
  } catch (err) {
    doc.status = 'error';
    doc.error = err.message || 'Не удалось распознать документ';
  }
  refreshFileList();
}

// Распознаём файлы ПОСЛЕДОВАТЕЛЬНО, не параллельно — тот же приём, что уже
// был у admin-recognize.js для одного файла: Gemini free tier ~20 запросов/
// мин (см. ways-of-working.md), параллельная пачка из нескольких файлов
// рисковала бы упереться в лимит сразу на нескольких документах одновременно.
recognizeBtn.addEventListener('click', async () => {
  if (!docs.length) return;
  acctError.style.display = 'none';
  recognizeBtn.disabled = true;
  exportBtn.disabled = true;
  acctLoading.style.display = '';

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

  // Показываем первый успешно распознанный документ (или первый вообще,
  // если все с ошибкой), чтобы правая колонка не оставалась пустой.
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
    const blob = await exportDocuments(session.get(), done.map(d => d.result));
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Одно имя на пачку, а не на файл — при экспорте нескольких документов
    // сразу отдельного смысла в имени первого файла нет.
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

if (session.get()) showMain(); else showGate();
