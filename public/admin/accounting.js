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
const recognizeBtn = document.getElementById('recognizeBtn');
const acctError = document.getElementById('acctError');
const acctLoading = document.getElementById('acctLoading');
const resultPanel = document.getElementById('resultPanel');
const previewImg = document.getElementById('previewImg');
const overallBadge = document.getElementById('overallBadge');
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
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const HEADER_FIELD_LABELS = {
  invoice_number: 'Номер счёта',
  invoice_date: 'Дата',
  seller_name: 'Продавец',
  seller_inn: 'ИНН продавца',
  buyer_name: 'Покупатель',
  buyer_inn: 'ИНН покупателя',
  subtotal: 'Сумма без НДС',
  vat_rate: 'Ставка НДС',
  vat_total: 'Сумма НДС',
  total: 'Итого',
  currency: 'Валюта'
};

const LOW_CONFIDENCE_THRESHOLD = 70;

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
// PASS/NOT_APPLICABLE рендерим свёрнуто, одной строкой на rule_id, чтобы не
// заваливать бухгалтера подтверждениями "всё ок" по каждой из 6+ проверок.
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
  if (passed.length) {
    const div = document.createElement('div');
    div.className = 'acct-rule acct-rule-PASS';
    div.textContent = `Пройдено без замечаний: ${passed.map(r => r.rule_id).join(', ')}`;
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
    previewImg.src = `data:${selectedFile.type};base64,${base64}`;

    const res = await authedFetch('/api/accounting/admin-recognize', {
      method: 'POST',
      body: JSON.stringify({ image: base64, mimeType: selectedFile.type })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);

    overallBadge.textContent = data.overall_status;
    overallBadge.className = `acct-badge acct-badge-${data.overall_status}`;
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
