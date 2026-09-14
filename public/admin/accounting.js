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
const fileName = document.getElementById('fileName');
const recognizeBtn = document.getElementById('recognizeBtn');
const acctError = document.getElementById('acctError');
const acctLoading = document.getElementById('acctLoading');
const resultPanel = document.getElementById('resultPanel');
const previewBox = document.getElementById('previewBox');
const overallBadge = document.getElementById('overallBadge');
const docTypeLabel = document.getElementById('docTypeLabel');
const headerTable = document.getElementById('headerTable');
const itemsBody = document.getElementById('itemsBody');
const rulesList = document.getElementById('rulesList');

let selectedFile = null;

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

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0] || null;
  recognizeBtn.disabled = !selectedFile;
  if (selectedFile) {
    fileName.textContent = selectedFile.name;
    fileName.style.display = '';
  } else {
    fileName.style.display = 'none';
  }
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
  delivery_note_number: 'Номер накладной',
  delivery_note_date: 'Дата',
  supplier_name: 'Поставщик',
  supplier_inn: 'ИНН поставщика',
  buyer_name: 'Покупатель',
  buyer_inn: 'ИНН покупателя',
  subtotal: 'Сумма без НДС',
  vat_rate: 'Ставка НДС',
  vat_total: 'Сумма НДС',
  total: 'Итого',
  currency: 'Валюта'
};

const DOC_TYPE_LABELS = {
  esf: 'Счет-фактура / ЭСФ',
  nakladnaya: 'Товарная накладная'
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

function renderItemsTable(items) {
  itemsBody.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.description?.value || '—'}</td>
      <td>${item.quantity?.value || '—'}</td>
      <td>${item.unit_price?.value || '—'}</td>
      <td>${item.amount?.value || '—'}</td>
      <td>${item.vat_rate?.value || '—'}</td>
      <td>${item.vat_amount?.value || '—'}</td>
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
    div.innerHTML = `<span class="acct-rule-id">${r.rule_id}</span><span>${r.message || r.status}</span>`;
    rulesList.appendChild(div);
  }
  const uniquePassedIds = [...new Set(passed.map(r => r.rule_id))];
  if (uniquePassedIds.length) {
    const div = document.createElement('div');
    div.className = 'acct-rule acct-rule-PASS';
    div.textContent = `Пройдено без замечаний (${uniquePassedIds.length}): ${uniquePassedIds.join(', ')}`;
    rulesList.appendChild(div);
  }
}

recognizeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  acctError.style.display = 'none';
  acctLoading.style.display = '';
  resultPanel.style.display = 'none';
  recognizeBtn.disabled = true;

  try {
    const base64 = await fileToBase64(selectedFile);
    renderPreview(selectedFile.type, base64);

    const res = await authedFetch('/api/accounting/admin-recognize', {
      method: 'POST',
      body: JSON.stringify({ image: base64, mimeType: selectedFile.type })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);

    overallBadge.textContent = data.overall_status;
    overallBadge.className = `acct-badge acct-badge-${data.overall_status}`;
    docTypeLabel.textContent = DOC_TYPE_LABELS[data.doc_type] || data.doc_type;
    renderHeaderTable(data.header);
    renderItemsTable(data.items);
    renderRules(data.validation);
    resultPanel.style.display = '';
  } catch (err) {
    acctError.textContent = err.message || 'Не удалось распознать документ';
    acctError.style.display = '';
  } finally {
    acctLoading.style.display = 'none';
    recognizeBtn.disabled = false;
  }
});

if (session.get()) showMain(); else showGate();
