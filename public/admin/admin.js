// Админка клиентов Тамги — внутренний инструмент, не связан с основным
// public/js/app.js. Секрет (x-admin-secret, см. lib/adminAuth.js) хранится
// в sessionStorage — сбрасывается при закрытии вкладки, чтобы не жить в
// браузере бессрочно, как localStorage.
//
// Список типов/полей документов переиспользуется из основной схемы фронтенда
// (public/js/config/docSchema.js) — та же схема, что использует сайт для
// ручного выбора типа, чтобы дропдаун/подсказки полей здесь не расходились
// с тем, что реально знает бэкенд (lib/docSchema.js — серверная копия).

import { DOC_TYPES, DOC_FIELDS, isTableType, columnsForType } from '../js/config/docSchema.js';

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
const fAccessPassword = document.getElementById('fAccessPassword');
const fAccessPasswordLabel = document.getElementById('fAccessPasswordLabel');
const passwordStatusBadge = document.getElementById('passwordStatusBadge');
const removePasswordRow = document.getElementById('removePasswordRow');
const fRemovePassword = document.getElementById('fRemovePassword');
const fDisplayName = document.getElementById('fDisplayName');
const fLogoUrl = document.getElementById('fLogoUrl');
const fAccentColor = document.getElementById('fAccentColor');
const accentSwatch = document.getElementById('accentSwatch');
const fDateFormat = document.getElementById('fDateFormat');
const fDecimalSeparator = document.getElementById('fDecimalSeparator');

const fieldOverridesList = document.getElementById('fieldOverridesList');
const addFieldOverrideBtn = document.getElementById('addFieldOverrideBtn');
const fieldOverrideEditor = document.getElementById('fieldOverrideEditor');
const overrideTypeSelect = document.getElementById('overrideTypeSelect');
const overrideChipsEl = document.getElementById('overrideChips');
const overrideFieldsLabel = document.getElementById('overrideFieldsLabel');
const confirmOverrideBtn = document.getElementById('confirmOverrideBtn');
const cancelOverrideBtn = document.getElementById('cancelOverrideBtn');

const legacyFieldsBox = document.getElementById('legacyFieldsBox');
const legacyChipsEl = document.getElementById('legacyChips');

const customTypesList = document.getElementById('customTypesList');
const addCustomTypeBtn = document.getElementById('addCustomTypeBtn');
const customTypeEditor = document.getElementById('customTypeEditor');
const newTypeName = document.getElementById('newTypeName');
const newTypeChipsEl = document.getElementById('newTypeChips');
const newTypeHint = document.getElementById('newTypeHint');
const confirmCustomTypeBtn = document.getElementById('confirmCustomTypeBtn');
const cancelCustomTypeBtn = document.getElementById('cancelCustomTypeBtn');

let editingId = null; // null — создаём нового клиента; иначе id редактируемой строки
let editingOverrideType = null; // null — добавляем новое переопределение; иначе редактируем существующее
let editingCustomTypeName = null; // аналогично, для кастомных типов

// Состояние формы для трёх структурированных блоков — отдельно от простых
// text-полей (те читаются прямо из DOM в buildPayload).
let state = { fieldOverrides: {}, customDocTypes: {}, legacyFields: [] };

// Табличные типы (накладная/УПД и т.д.) теперь тоже поддерживают override —
// для них значения переопределения означают КОЛОНКИ, а не подписи полей (см.
// lib/extraction.js:resolveTableColumns) — поэтому полный список типов, без фильтра.

function adminFetch(path, options = {}) {
  const secret = sessionStorage.getItem(SECRET_KEY);
  return fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret, ...(options.headers || {}) }
  });
}

// --- Переиспользуемый редактор списка полей: чипы с крестиком + добавление
// своего значения + (опционально) кнопки-подсказки из стандартной схемы типа. ---

function createChipEditor(container, initialValues) {
  container.innerHTML = '';
  let values = [...(initialValues || [])];

  const selectedRow = document.createElement('div');
  selectedRow.className = 'admin-chip-editor-selected';
  const addRow = document.createElement('div');
  addRow.className = 'admin-chip-add-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'admin-input';
  input.placeholder = 'Своё поле — введите название и нажмите «Добавить»';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-secondary';
  addBtn.type = 'button';
  addBtn.textContent = 'Добавить';
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  const suggestionsRow = document.createElement('div');
  suggestionsRow.className = 'admin-chip-suggestions';

  container.appendChild(selectedRow);
  container.appendChild(addRow);
  container.appendChild(suggestionsRow);

  let suggestions = [];

  function renderSelected() {
    selectedRow.innerHTML = '';
    values.forEach(v => {
      const chip = document.createElement('span');
      chip.className = 'admin-chip';
      const text = document.createElement('span');
      text.textContent = v;
      chip.appendChild(text);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.title = 'Убрать поле';
      removeBtn.addEventListener('click', () => {
        values = values.filter(x => x !== v);
        renderSelected();
        renderSuggestions();
      });
      chip.appendChild(removeBtn);
      selectedRow.appendChild(chip);
    });
  }

  function renderSuggestions() {
    suggestionsRow.innerHTML = '';
    suggestions.filter(s => !values.includes(s)).forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'admin-chip-suggestion';
      btn.textContent = '+ ' + s;
      btn.addEventListener('click', () => {
        values.push(s);
        renderSelected();
        renderSuggestions();
      });
      suggestionsRow.appendChild(btn);
    });
  }

  function addFromInput() {
    const v = input.value.trim();
    if (!v || values.includes(v)) { input.value = ''; return; }
    values.push(v);
    input.value = '';
    renderSelected();
    renderSuggestions();
  }
  addBtn.addEventListener('click', addFromInput);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFromInput(); } });

  renderSelected();

  return {
    getValues: () => values,
    setSuggestions: (list) => { suggestions = list || []; renderSuggestions(); }
  };
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
  if (client.has_password) badges.push('🔒 Пароль на сайт');
  if (client.fields && client.fields.length) badges.push('Устар. поля (любой тип)');
  if (client.field_overrides && Object.keys(client.field_overrides).length) badges.push(`Переопределений: ${Object.keys(client.field_overrides).length}`);
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

// --- Блок «Переопределение полей» ---

function renderFieldOverridesList() {
  fieldOverridesList.innerHTML = '';
  const types = Object.keys(state.fieldOverrides);
  types.forEach(type => {
    const item = document.createElement('div');
    item.className = 'admin-override-item';

    const main = document.createElement('div');
    main.className = 'admin-override-item-main';
    const title = document.createElement('div');
    title.className = 'admin-override-item-title';
    title.textContent = type;
    main.appendChild(title);
    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'admin-override-item-fields';
    state.fieldOverrides[type].forEach(f => {
      const badge = document.createElement('span');
      badge.className = 'admin-badge';
      badge.textContent = f;
      fieldsWrap.appendChild(badge);
    });
    main.appendChild(fieldsWrap);
    item.appendChild(main);

    const btns = document.createElement('div');
    const editBtn = document.createElement('button');
    editBtn.className = 'admin-link-btn';
    editBtn.textContent = 'Изменить';
    editBtn.style.marginRight = '10px';
    editBtn.addEventListener('click', () => openOverrideEditor(type));
    const removeBtn = document.createElement('button');
    removeBtn.className = 'admin-override-item-remove';
    removeBtn.textContent = 'Удалить';
    removeBtn.addEventListener('click', () => { delete state.fieldOverrides[type]; renderFieldOverridesList(); });
    btns.appendChild(editBtn);
    btns.appendChild(removeBtn);
    item.appendChild(btns);

    fieldOverridesList.appendChild(item);
  });
}

let overrideChipEditor = null;

// DOC_FIELDS[type] для табличных типов — это объект {mode, columns, keys,
// description}, а не плоский массив полей: передать его напрямую в
// setSuggestions сломало бы её на .filter() (метод массива). Для табличных
// типов подсказки нужно брать из columnsForType(type) — это плоский массив
// названий колонок, ровно то, что setSuggestions ожидает на входе.
function suggestionsForOverrideType(type) {
  return isTableType(type) ? (columnsForType(type) || []) : (DOC_FIELDS[type] || []);
}

// Для табличных типов override — это КОЛОНКИ таблицы, для карточных — ПОЛЯ
// label/value (см. lib/extraction.js:resolveTableColumns). Подпись поля ввода
// переключается соответственно, чтобы не путать админа терминологией.
function updateOverrideFieldsLabel(type) {
  overrideFieldsLabel.textContent = isTableType(type) ? 'Колонки' : 'Поля';
}

function openOverrideEditor(existingType) {
  editingOverrideType = existingType || null;
  overrideTypeSelect.innerHTML = '';
  const usedTypes = Object.keys(state.fieldOverrides);
  const availableTypes = DOC_TYPES.filter(t => t === existingType || !usedTypes.includes(t));
  availableTypes.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    overrideTypeSelect.appendChild(opt);
  });
  overrideTypeSelect.value = existingType || availableTypes[0];
  overrideTypeSelect.disabled = !!existingType; // при редактировании тип не меняем — только поля/колонки

  const initial = existingType ? state.fieldOverrides[existingType] : [];
  overrideChipEditor = createChipEditor(overrideChipsEl, initial);
  overrideChipEditor.setSuggestions(suggestionsForOverrideType(overrideTypeSelect.value));
  updateOverrideFieldsLabel(overrideTypeSelect.value);

  fieldOverrideEditor.style.display = 'block';
  fieldOverrideEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

overrideTypeSelect.addEventListener('change', () => {
  if (overrideChipEditor) overrideChipEditor.setSuggestions(suggestionsForOverrideType(overrideTypeSelect.value));
  updateOverrideFieldsLabel(overrideTypeSelect.value);
});

addFieldOverrideBtn.addEventListener('click', () => {
  if (!DOC_TYPES.some(t => !Object.keys(state.fieldOverrides).includes(t))) {
    alert('Переопределения уже добавлены для всех поддерживаемых типов документов.');
    return;
  }
  openOverrideEditor(null);
});
cancelOverrideBtn.addEventListener('click', () => { fieldOverrideEditor.style.display = 'none'; });
confirmOverrideBtn.addEventListener('click', () => {
  const type = overrideTypeSelect.value;
  const values = overrideChipEditor.getValues();
  if (!type || !values.length) { alert('Выберите тип и добавьте хотя бы одно поле.'); return; }
  state.fieldOverrides[type] = values;
  fieldOverrideEditor.style.display = 'none';
  renderFieldOverridesList();
});

// --- Устаревшее общее поле fields (обратная совместимость) ---

let legacyChipEditor = null;

function renderLegacyFields() {
  if (!state.legacyFields.length) {
    legacyFieldsBox.style.display = 'none';
    return;
  }
  legacyFieldsBox.style.display = 'block';
  legacyChipEditor = createChipEditor(legacyChipsEl, state.legacyFields);
}

// --- Блок «Кастомные типы документов» ---

function renderCustomTypesList() {
  customTypesList.innerHTML = '';
  Object.keys(state.customDocTypes).forEach(name => {
    const entry = state.customDocTypes[name];
    const item = document.createElement('div');
    item.className = 'admin-override-item';

    const main = document.createElement('div');
    main.className = 'admin-override-item-main';
    const title = document.createElement('div');
    title.className = 'admin-override-item-title';
    title.textContent = name;
    main.appendChild(title);
    if (entry.hint) {
      const hint = document.createElement('div');
      hint.className = 'admin-override-item-hint';
      hint.textContent = entry.hint;
      main.appendChild(hint);
    }
    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'admin-override-item-fields';
    (entry.fields || []).forEach(f => {
      const badge = document.createElement('span');
      badge.className = 'admin-badge';
      badge.textContent = f;
      fieldsWrap.appendChild(badge);
    });
    main.appendChild(fieldsWrap);
    item.appendChild(main);

    const btns = document.createElement('div');
    const editBtn = document.createElement('button');
    editBtn.className = 'admin-link-btn';
    editBtn.textContent = 'Изменить';
    editBtn.style.marginRight = '10px';
    editBtn.addEventListener('click', () => openCustomTypeEditor(name));
    const removeBtn = document.createElement('button');
    removeBtn.className = 'admin-override-item-remove';
    removeBtn.textContent = 'Удалить';
    removeBtn.addEventListener('click', () => { delete state.customDocTypes[name]; renderCustomTypesList(); });
    btns.appendChild(editBtn);
    btns.appendChild(removeBtn);
    item.appendChild(btns);

    customTypesList.appendChild(item);
  });
}

let newTypeChipEditor = null;

function openCustomTypeEditor(existingName) {
  editingCustomTypeName = existingName || null;
  newTypeName.value = existingName || '';
  newTypeName.disabled = !!existingName; // переименование не поддерживаем — удалите и добавьте заново
  newTypeHint.value = existingName ? (state.customDocTypes[existingName].hint || '') : '';
  const initial = existingName ? (state.customDocTypes[existingName].fields || []) : [];
  newTypeChipEditor = createChipEditor(newTypeChipsEl, initial); // без подсказок — тип новый, стандартной схемы для него нет

  customTypeEditor.style.display = 'block';
  customTypeEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

addCustomTypeBtn.addEventListener('click', () => openCustomTypeEditor(null));
cancelCustomTypeBtn.addEventListener('click', () => { customTypeEditor.style.display = 'none'; });
confirmCustomTypeBtn.addEventListener('click', () => {
  const name = newTypeName.value.trim();
  const values = newTypeChipEditor.getValues();
  if (!name || !values.length) { alert('Укажите название типа и добавьте хотя бы одно поле.'); return; }
  if (!editingCustomTypeName && DOC_TYPES.includes(name)) {
    alert(`«${name}» совпадает со стандартным типом документа. Чтобы переопределить его поля, используйте блок «Переопределение полей» выше.`);
    return;
  }
  state.customDocTypes[name] = { fields: values };
  if (newTypeHint.value.trim()) state.customDocTypes[name].hint = newTypeHint.value.trim();
  customTypeEditor.style.display = 'none';
  renderCustomTypesList();
});

// --- Форма создания/редактирования клиента ---

function resetForm() {
  fApiKey.value = '';
  fSlug.value = '';
  fLabel.value = '';
  fAccessPassword.value = '';
  fRemovePassword.checked = false;
  fDisplayName.value = '';
  fLogoUrl.value = '';
  fAccentColor.value = '';
  fDateFormat.value = '';
  fDecimalSeparator.value = '';
  formError.style.display = 'none';
  fieldOverrideEditor.style.display = 'none';
  customTypeEditor.style.display = 'none';
  state = { fieldOverrides: {}, customDocTypes: {}, legacyFields: [] };
  renderFieldOverridesList();
  renderCustomTypesList();
  renderLegacyFields();
  renderPasswordStatus(false);
  updateSwatch();
}

// Пароль всегда приходит с сервера как has_password (булево), НИКОГДА как
// хеш или plaintext (см. api/admin/clients.js:sanitizeClientRow) — поле ввода
// поэтому всегда пустое при открытии карточки, а не "текущее значение".
// hasPassword управляет только видимостью подсказки/чекбокса "убрать пароль".
function renderPasswordStatus(hasPassword) {
  if (hasPassword) {
    passwordStatusBadge.textContent = '🔒 Пароль уже задан — оставьте поле пустым, чтобы не менять его.';
    passwordStatusBadge.style.display = 'block';
    fAccessPasswordLabel.textContent = 'Новый пароль';
    removePasswordRow.style.display = 'block';
  } else {
    passwordStatusBadge.style.display = 'none';
    fAccessPasswordLabel.textContent = 'Пароль';
    removePasswordRow.style.display = 'none';
  }
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
    state.fieldOverrides = client.field_overrides ? JSON.parse(JSON.stringify(client.field_overrides)) : {};
    state.customDocTypes = client.custom_doc_types ? JSON.parse(JSON.stringify(client.custom_doc_types)) : {};
    state.legacyFields = Array.isArray(client.fields) ? [...client.fields] : [];
    renderPasswordStatus(!!client.has_password);
    renderFieldOverridesList();
    renderCustomTypesList();
    renderLegacyFields();
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
  const formatting = {};
  if (fDateFormat.value) formatting.dateFormat = fDateFormat.value;
  if (fDecimalSeparator.value) formatting.decimalSeparator = fDecimalSeparator.value;

  const legacyFields = legacyChipEditor ? legacyChipEditor.getValues() : state.legacyFields;

  const payload = {
    api_key: fApiKey.value.trim(),
    client_slug: fSlug.value.trim(),
    label: fLabel.value.trim(),
    display_name: fDisplayName.value.trim(),
    logo_url: fLogoUrl.value.trim(),
    accent_color: fAccentColor.value.trim(),
    fields: legacyFields.length ? legacyFields : null,
    field_overrides: Object.keys(state.fieldOverrides).length ? state.fieldOverrides : null,
    custom_doc_types: Object.keys(state.customDocTypes).length ? state.customDocTypes : null,
    formatting: Object.keys(formatting).length ? formatting : null
  };
  // Пароль — особый случай, см. api/admin/clients.js:validateAndNormalize:
  // 'убрать пароль' и 'задать новый' взаимоисключающие, отсутствие обоих —
  // 'не трогать существующий'. Чекбокс имеет приоритет над текстом в поле —
  // если человек и ввёл что-то, и отметил "убрать", убираем.
  if (fRemovePassword.checked) {
    payload.remove_access_password = true;
  } else if (fAccessPassword.value) {
    payload.access_password = fAccessPassword.value;
  }
  return payload;
}

saveClientBtn.addEventListener('click', async () => {
  formError.style.display = 'none';
  const payload = buildPayload();

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
