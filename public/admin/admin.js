// Админка клиентов Тамги — внутренний инструмент, не связан с основным
// public/js/app.js. Секрет (x-admin-secret, см. lib/adminAuth.js) хранится
// в sessionStorage — сбрасывается при закрытии вкладки, чтобы не жить в
// браузере бессрочно, как localStorage.

const SECRET_KEY = 'tamga_admin_secret';

const gate = document.getElementById('gate');
const gateBtn = document.getElementById('gateBtn');
const secretInput = document.getElementById('secretInput');
const gateError = document.getElementById('gateError');
const adminMain = document.getElementById('adminMain');

const newClientBtn = document.getElementById('newClientBtn');
const clientsEmpty = document.getElementById('clientsEmpty');
const clientsTableWrap = document.getElementById('clientsTableWrap');
const clientsBody = document.getElementById('clientsBody');

const formPanel = document.getElementById('formPanel');
const formTitle = document.getElementById('formTitle');
const formError = document.getElementById('formError');
const saveClientBtn = document.getElementById('saveClientBtn');
const cancelFormBtn = document.getElementById('cancelFormBtn');
const deleteClientBtn = document.getElementById('deleteClientBtn');

const fApiKey = document.getElementById('fApiKey');
const fSlug = document.getElementById('fSlug');
const fLabel = document.getElementById('fLabel');
const fDisplayName = document.getElementById('fDisplayName');
const fLogoUrl = document.getElementById('fLogoUrl');
const fAccentColor = document.getElementById('fAccentColor');
const accentSwatch = document.getElementById('accentSwatch');
const fDateFormat = document.getElementById('fDateFormat');
const fDecimalSeparator = document.getElementById('fDecimalSeparator');
const fFields = document.getElementById('fFields');
const fCustomDocTypes = document.getElementById('fCustomDocTypes');
const customDocTypesError = document.getElementById('customDocTypesError');

let editingId = null; // null — создаём нового; иначе id редактируемой строки

function adminFetch(path, options = {}) {
  const secret = sessionStorage.getItem(SECRET_KEY);
  return fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret, ...(options.headers || {}) }
  });
}

// --- Гейт по секрету ---

async function tryEnter(secret) {
  gateError.style.display = 'none';
  sessionStorage.setItem(SECRET_KEY, secret);
  const res = await adminFetch('/api/admin/clients');
  if (res.status === 401 || res.status === 500) {
    sessionStorage.removeItem(SECRET_KEY);
    const data = await res.json().catch(() => ({}));
    gateError.textContent = data.error || 'Не удалось войти';
    gateError.style.display = 'block';
    return false;
  }
  if (!res.ok) {
    gateError.textContent = 'Сервер вернул ошибку, попробуйте ещё раз';
    gateError.style.display = 'block';
    return false;
  }
  const clients = await res.json();
  gate.style.display = 'none';
  adminMain.style.display = 'block';
  renderClients(clients);
  return true;
}

gateBtn.addEventListener('click', () => tryEnter(secretInput.value.trim()));
secretInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryEnter(secretInput.value.trim()); });

// Если секрет уже сохранён с прошлого раза (та же вкладка) — входим сразу.
if (sessionStorage.getItem(SECRET_KEY)) {
  tryEnter(sessionStorage.getItem(SECRET_KEY));
}

// --- Список клиентов ---

function formatUpdatedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function badgesFor(client) {
  const badges = [];
  if (client.fields && client.fields.length) badges.push(`Полей: ${client.fields.length}`);
  if (client.custom_doc_types && Object.keys(client.custom_doc_types).length) badges.push(`Своих типов: ${Object.keys(client.custom_doc_types).length}`);
  if (client.formatting && (client.formatting.dateFormat || client.formatting.decimalSeparator)) badges.push('Формат');
  if (client.display_name || client.logo_url || client.accent_color) badges.push('Фасад');
  return badges;
}

function renderClients(clients) {
  if (!clients.length) {
    clientsEmpty.style.display = 'block';
    clientsTableWrap.style.display = 'none';
    return;
  }
  clientsEmpty.style.display = 'none';
  clientsTableWrap.style.display = 'block';
  clientsBody.innerHTML = '';

  clients.forEach(client => {
    const tr = document.createElement('tr');

    const idCell = document.createElement('td');
    idCell.className = 'admin-id-cell';
    if (client.api_key) { const d = document.createElement('div'); d.textContent = `API: ${client.api_key}`; idCell.appendChild(d); }
    if (client.client_slug) { const d = document.createElement('div'); d.textContent = `Slug: ${client.client_slug}`; idCell.appendChild(d); }
    tr.appendChild(idCell);

    const labelCell = document.createElement('td');
    labelCell.textContent = client.label || '—';
    tr.appendChild(labelCell);

    const badgesCell = document.createElement('td');
    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'admin-badges';
    const badges = badgesFor(client);
    if (!badges.length) {
      badgeWrap.textContent = '—';
    } else {
      badges.forEach(b => {
        const span = document.createElement('span');
        span.className = 'admin-badge';
        span.textContent = b;
        badgeWrap.appendChild(span);
      });
    }
    badgesCell.appendChild(badgeWrap);
    tr.appendChild(badgesCell);

    const updatedCell = document.createElement('td');
    updatedCell.className = 'admin-updated';
    updatedCell.textContent = formatUpdatedAt(client.updated_at);
    tr.appendChild(updatedCell);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'admin-row-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'admin-link-btn';
    editBtn.textContent = 'Изменить';
    editBtn.addEventListener('click', () => openForm(client));
    actionsCell.appendChild(editBtn);
    tr.appendChild(actionsCell);

    clientsBody.appendChild(tr);
  });
}

async function reloadClients() {
  const res = await adminFetch('/api/admin/clients');
  if (!res.ok) return;
  renderClients(await res.json());
}

// --- Форма создания/редактирования ---

function resetForm() {
  fApiKey.value = '';
  fSlug.value = '';
  fLabel.value = '';
  fDisplayName.value = '';
  fLogoUrl.value = '';
  fAccentColor.value = '';
  fDateFormat.value = '';
  fDecimalSeparator.value = '';
  fFields.value = '';
  fCustomDocTypes.value = '';
  formError.style.display = 'none';
  customDocTypesError.style.display = 'none';
  updateSwatch();
}

function updateSwatch() {
  accentSwatch.style.background = fAccentColor.value.trim() || 'var(--accent)';
}
fAccentColor.addEventListener('input', updateSwatch);

function openForm(client) {
  resetForm();
  if (client) {
    editingId = client.id;
    formTitle.textContent = `Клиент: ${client.label || client.client_slug || client.api_key}`;
    deleteClientBtn.style.display = 'inline-block';
    fApiKey.value = client.api_key || '';
    fSlug.value = client.client_slug || '';
    fLabel.value = client.label || '';
    fDisplayName.value = client.display_name || '';
    fLogoUrl.value = client.logo_url || '';
    fAccentColor.value = client.accent_color || '';
    fDateFormat.value = (client.formatting && client.formatting.dateFormat) || '';
    fDecimalSeparator.value = (client.formatting && client.formatting.decimalSeparator) || '';
    fFields.value = (client.fields || []).join('\n');
    fCustomDocTypes.value = client.custom_doc_types ? JSON.stringify(client.custom_doc_types, null, 2) : '';
    updateSwatch();
  } else {
    editingId = null;
    formTitle.textContent = 'Новый клиент';
    deleteClientBtn.style.display = 'none';
  }
  formPanel.style.display = 'block';
  formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

newClientBtn.addEventListener('click', () => openForm(null));
cancelFormBtn.addEventListener('click', () => { formPanel.style.display = 'none'; });

function buildPayload() {
  const fields = fFields.value.split('\n').map(s => s.trim()).filter(Boolean);

  let customDocTypes = null;
  customDocTypesError.style.display = 'none';
  if (fCustomDocTypes.value.trim()) {
    try {
      customDocTypes = JSON.parse(fCustomDocTypes.value);
    } catch (e) {
      customDocTypesError.textContent = 'Некорректный JSON: ' + e.message;
      customDocTypesError.style.display = 'block';
      return null;
    }
  }

  const formatting = {};
  if (fDateFormat.value) formatting.dateFormat = fDateFormat.value;
  if (fDecimalSeparator.value) formatting.decimalSeparator = fDecimalSeparator.value;

  return {
    api_key: fApiKey.value.trim(),
    client_slug: fSlug.value.trim(),
    label: fLabel.value.trim(),
    display_name: fDisplayName.value.trim(),
    logo_url: fLogoUrl.value.trim(),
    accent_color: fAccentColor.value.trim(),
    fields: fields.length ? fields : null,
    custom_doc_types: customDocTypes,
    formatting: Object.keys(formatting).length ? formatting : null
  };
}

saveClientBtn.addEventListener('click', async () => {
  formError.style.display = 'none';
  const payload = buildPayload();
  if (!payload) return; // ошибка JSON уже показана

  const path = editingId ? `/api/admin/clients?id=${encodeURIComponent(editingId)}` : '/api/admin/clients';
  const method = editingId ? 'PATCH' : 'POST';
  const res = await adminFetch(path, { method, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    formError.textContent = data.error || `Сервер вернул ошибку ${res.status}`;
    formError.style.display = 'block';
    return;
  }

  formPanel.style.display = 'none';
  await reloadClients();
});

deleteClientBtn.addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('Удалить этого клиента? Действие необратимо — все его настройки (поля, типы, фасад) будут потеряны.')) return;
  const res = await adminFetch(`/api/admin/clients?id=${encodeURIComponent(editingId)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    formError.textContent = data.error || 'Не удалось удалить';
    formError.style.display = 'block';
    return;
  }
  formPanel.style.display = 'none';
  await reloadClients();
});
