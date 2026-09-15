// public/admin/accounting.js — review-экран модуля бухгалтерии (§19 хендовера).
// Гейт переиспользует ТОТ ЖЕ секрет/сессию, что public/admin/admin.js
// (SECRET_KEY='tamga_admin_secret', createIdleSession из ../js/idleSession.js) —
// одна и та же admin-сессия открывает обе страницы, второй логин не нужен.

import { createIdleSession } from '../js/idleSession.js';

const SECRET_KEY = 'tamga_admin_secret';
const session = createIdleSession(SECRET_KEY);

const gate = document.getElementById('gate');
const gateBtn = document.getElementById('gateBtn');
const secretInput = document.getElementById('secretInput');
const gateError = document.getElementById('gateError');
const acctMain = document.getElementById('acctMain');

const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
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
// файл независимый документ, без сверки между ними. "docs" — по одной
// записи на выбранный файл, в порядке выбора:
//   { file: File, status: 'pending'|'recognizing'|'done'|'error',
//     result: <ответ admin-recognize> | null, error: string | null }
// base64 не кэшируется на весь батч заранее — считается по одному прямо
// перед отправкой на распознавание (и повторно при показе превью того же
// файла), чтобы не держать в памяти все файлы сразу в base64 одновременно.
let docs = [];
let activeIndex = -1;

async function authedFetch(path, options = {}) {
  const secret = session.get();
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret, ...(options.headers || {}) }
  });
  return res;
}

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

const FILE_STATUS_LABELS = { pending: 'В очереди', recognizing: 'Распознаём...', done: 'Готово', error: 'Ошибка' };

function renderFileList() {
  if (!docs.length) {
    fileList.style.display = 'none';
    fileList.innerHTML = '';
    return;
  }
  fileList.style.display = '';
  fileList.innerHTML = '';
  docs.forEach((doc, index) => {
    const row = document.createElement('div');
    row.className = `acct-file-item${index === activeIndex ? ' acct-file-active' : ''}`;
    row.innerHTML = `
      <span class="acct-file-name">${doc.file.name}</span>
      <span class="acct-file-status acct-file-status-${doc.status}">${FILE_STATUS_LABELS[doc.status]}</span>
    `;
    row.addEventListener('click', () => selectDoc(index));
    fileList.appendChild(row);
  });
}

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;
  // Новый выбор файлов ЗАМЕНЯЕТ предыдущий батч (а не добавляет к нему) —
  // самое предсказуемое поведение для input[type=file], без отдельного
  // UI "добавить ещё"/"очистить список" в этом первом срезе.
  docs = files.map(file => ({ file, status: 'pending', result: null, error: null }));
  activeIndex = -1;
  resultPanel.style.display = 'none';
  exportBtn.disabled = true;
  acctError.style.display = 'none';
  renderFileList();
  recognizeBtn.disabled = false;
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Один общий словарь на все типы документов (backend отдаёт только поля,
// реально принадлежащие определённому doc_type — см. splitRawResult в
// pipeline.js, — так что пересечения ключей здесь не создают путаницы:
// для конкретного результата в header присутствуют только его собственные
// поля). Накладная (14 сен 2026) добавила delivery_note_number/_date,
// supplier_name/_inn — остальные её поля (buyer_*/subtotal/vat_total/total/
// currency) уже были общими с ЭСФ.
const HEADER_FIELD_LABELS = {
  invoice_number: 'Номер счёта',
  invoice_date: 'Дата',
  seller_name: 'Продавец',
  seller_inn: 'ИНН продавца',
  seller_bank_name: 'Банк продавца',
  seller_bik: 'БИК продавца',
  seller_account: 'Расчётный счёт продавца',
  seller_correspondent_account: 'Корр. счёт продавца',
  delivery_note_number: 'Номер накладной',
  delivery_note_date: 'Дата',
  supplier_name: 'Поставщик',
  supplier_inn: 'ИНН поставщика',
  supplier_bank_name: 'Банк поставщика',
  supplier_bik: 'БИК поставщика',
  supplier_account: 'Расчётный счёт поставщика',
  supplier_correspondent_account: 'Корр. счёт поставщика',
  act_number: 'Номер акта',
  act_date: 'Дата',
  contractor_name: 'Исполнитель',
  contractor_inn: 'ИНН исполнителя',
  contractor_bank_name: 'Банк исполнителя',
  contractor_bik: 'БИК исполнителя',
  contractor_account: 'Расчётный счёт исполнителя',
  contractor_correspondent_account: 'Корр. счёт исполнителя',
  payment_order_number: 'Номер платёжного поручения',
  payment_order_date: 'Дата',
  recipient_name: 'Получатель',
  recipient_inn: 'ИНН получателя',
  buyer_account: 'Счёт плательщика',
  recipient_account: 'Счёт получателя',
  payment_purpose: 'Назначение платежа',
  buyer_name: 'Покупатель',
  buyer_inn: 'ИНН покупателя',
  subtotal: 'Сумма без НДС',
  vat_rate: 'Ставка НДС',
  vat_total: 'Сумма НДС',
  total: 'Итого',
  currency: 'Валюта',
  additional_notes: 'Доп. текст (подпись/печать/реквизиты договора)'
};

const DOC_TYPE_LABELS = {
  esf: 'Счет-фактура / ЭСФ',
  nakladnaya: 'Товарная накладная',
  act: 'Акт выполненных работ',
  payment_order: 'Платёжное поручение'
};

// Человеко-читаемые названия правил для интерфейса — только для отображения.
// Сам rule_id (INV-002, NAK-002...) остаётся техническим идентификатором:
// он же хранится в Supabase (accounting_rules_registry, accounting_rule_results),
// на него ссылаются тесты и миграции — трогать его ради читаемости UI не
// стали (Ethan, 14 сен 2026: "только подпись в интерфейсе"). Показываем
// рядом с названием как маленькую техническую пометку — см. renderRules.
const RULE_LABELS = {
  'INV-001': 'Обязательные поля',
  'INV-INN': 'Формат ИНН',
  'INV-002': 'Кол-во × цена = сумма строки',
  'INV-003': 'Сумма строк = сумма без НДС',
  'INV-004': 'База × ставка НДС = сумма НДС',
  'INV-005': 'Сумма без НДС + НДС = итого',
  'INV-006': 'Сумма НДС по строкам = НДС документа',
  'INV-CONF': 'Уверенность распознавания',
  'NAK-001': 'Обязательные поля',
  'NAK-INN': 'Формат ИНН',
  'NAK-002': 'Кол-во × цена = сумма строки',
  'NAK-003': 'Сумма строк = сумма без НДС',
  'NAK-004': 'Сумма без НДС + НДС = итого',
  'NAK-CONF': 'Уверенность распознавания',
  'ACT-001': 'Обязательные поля',
  'ACT-INN': 'Формат ИНН',
  'ACT-002': 'Кол-во × цена = сумма строки',
  'ACT-003': 'Сумма строк = сумма без НДС',
  'ACT-004': 'Сумма без НДС + НДС = итого',
  'ACT-CONF': 'Уверенность распознавания',
  'PP-001': 'Обязательные поля',
  'PP-INN': 'Формат ИНН',
  'PP-CONF': 'Уверенность распознавания'
};

const LOW_CONFIDENCE_THRESHOLD = 70;

// <img> не показывает PDF (это не картинка), а <embed>/<iframe> с PDF на
// мобильном Chrome ненадёжны (часто пусто/плейсхолдер вместо содержимого) —
// поэтому PDF открывается по ссылке в системном просмотрщике/новой вкладке
// через blob:, а не встраивается инлайн. Картинки — как раньше, инлайн.
let previewBlobUrl = null;

function renderPreview(mimeType, base64) {
  if (previewBlobUrl) { URL.revokeObjectURL(previewBlobUrl); previewBlobUrl = null; }

  if (mimeType === 'application/pdf') {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    previewBlobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    previewBox.innerHTML = `<a href="${previewBlobUrl}" target="_blank" rel="noopener" class="btn-secondary">Открыть PDF</a>`;
    return;
  }
  previewBox.innerHTML = `<img src="data:${mimeType};base64,${base64}" class="acct-preview" alt="Загруженный документ">`;
}

function renderHeaderTable(header) {
  headerTable.innerHTML = '';
  for (const [key, label] of Object.entries(HEADER_FIELD_LABELS)) {
    const field = header[key];
    if (!field) continue;
    const row = document.createElement('tr');
    const low = field.confidence != null && field.confidence < LOW_CONFIDENCE_THRESHOLD;
    row.innerHTML = `
      <td class="acct-field-name">${label}</td>
      <td class="${low ? 'acct-low-confidence' : ''}">${field.value || '—'}${low ? ` (уверенность ${field.confidence}%)` : ''}</td>
    `;
    headerTable.appendChild(row);
  }
}

// Платёжное поручение (15 сен 2026) не имеет таблицы строк — items всегда
// пустой массив для этого типа (см. buildPaymentOrderDoc). Прячем секцию
// "Строки" целиком вместо пустой таблицы с заголовками, но без содержимого.
function renderItemsTable(items) {
  itemsBody.innerHTML = '';
  const hasItems = Array.isArray(items) && items.length > 0;
  itemsSection.style.display = hasItems ? '' : 'none';
  itemsSectionTitle.style.display = hasItems ? '' : 'none';
  if (!hasItems) return;
  for (const item of items) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td data-label="Наименование">${item.description?.value || '—'}</td>
      <td data-label="Кол-во">${item.quantity?.value || '—'}</td>
      <td data-label="Цена">${item.unit_price?.value || '—'}</td>
      <td data-label="Сумма">${item.amount?.value || '—'}</td>
      <td data-label="Ставка НДС">${item.vat_rate?.value || '—'}</td>
      <td data-label="Сумма НДС">${item.vat_amount?.value || '—'}</td>
    `;
    itemsBody.appendChild(row);
  }
}

// Только не-PASS/не-NOT_APPLICABLE проверки показываем текстом (message) —
// PASS/NOT_APPLICABLE рендерим свёрнуто, ОДИН РАЗ на rule_id (правило может
// вернуть несколько результатов — по одному на поле/строку, — так что без
// dedupe тут был бы 'INV-001, INV-001, INV-001, INV-CONF, INV-CONF, ...',
// см. скриншот Ethan, 14 сен 2026), просто чтобы бухгалтер видел, что
// остальное проверялось и вопросов не вызвало.
function renderRules(results) {
  rulesList.innerHTML = '';
  const passed = results.filter(r => r.status === 'PASS' || r.status === 'NOT_APPLICABLE');
  const rest = results.filter(r => r.status !== 'PASS' && r.status !== 'NOT_APPLICABLE');

  for (const r of rest) {
    const div = document.createElement('div');
    div.className = `acct-rule acct-rule-${r.status}`;
    const label = RULE_LABELS[r.rule_id] || r.rule_id;
    div.innerHTML = `<span class="acct-rule-id" title="${r.rule_id}">${label}</span><span>${r.message || r.status}</span>`;
    rulesList.appendChild(div);
  }
  const uniquePassedIds = [...new Set(passed.map(r => r.rule_id))];
  if (uniquePassedIds.length) {
    const div = document.createElement('div');
    div.className = 'acct-rule acct-rule-PASS';
    const labels = uniquePassedIds.map(id => RULE_LABELS[id] || id);
    div.textContent = `Пройдено без замечаний (${uniquePassedIds.length}): ${labels.join(', ')}`;
    rulesList.appendChild(div);
  }
}

// Показывает документ по индексу в правой/левой колонках (превью + поля +
// проверки) — общая функция для клика по строке списка и для показа только
// что распознанного документа сразу после recognize.
async function selectDoc(index) {
  const doc = docs[index];
  if (!doc) return;
  activeIndex = index;
  renderFileList();

  const base64 = await fileToBase64(doc.file);
  renderPreview(doc.file.type, base64);

  if (doc.status === 'error') {
    resultPanel.style.display = 'none';
    return;
  }
  if (doc.status !== 'done' || !doc.result) {
    resultPanel.style.display = 'none';
    return;
  }
  const data = doc.result;
  overallBadge.textContent = data.overall_status;
  overallBadge.className = `acct-badge acct-badge-${data.overall_status}`;
  docTypeLabel.textContent = DOC_TYPE_LABELS[data.doc_type] || data.doc_type;
  renderHeaderTable(data.header);
  renderItemsTable(data.items);
  renderRules(data.validation);
  resultPanel.style.display = '';
}

async function recognizeOne(doc) {
  doc.status = 'recognizing';
  doc.error = null;
  renderFileList();

  try {
    const base64 = await fileToBase64(doc.file);
    const res = await authedFetch('/api/accounting/admin-recognize', {
      method: 'POST',
      body: JSON.stringify({ image: base64, mimeType: doc.file.type })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
    doc.status = 'done';
    doc.result = { ...data, file_name: doc.file.name };
  } catch (err) {
    doc.status = 'error';
    doc.error = err.message || 'Не удалось распознать документ';
  }
  renderFileList();
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
    const res = await authedFetch('/api/accounting/export', {
      method: 'POST',
      body: JSON.stringify({ documents: done.map(d => d.result) })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Ошибка ${res.status}`);
    }
    const blob = await res.blob();
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
