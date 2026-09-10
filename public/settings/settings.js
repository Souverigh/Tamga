// Самообслуживание клиента (Ethan, 8 сен 2026: "чтобы клиенты сами меняли
// поля/добавляли типы документов/устанавливали свои бизнес-правила") — в
// дополнение к /admin (там Ethan, доступ ко ВСЕМ клиентам сразу; здесь —
// сам клиент, доступ ТОЛЬКО к своей странице, через ?client=slug).
//
// Пароль — тот же, что и для входа в сам инструмент распознавания (Ethan
// выбрал этот вариант явно, из двух предложенных). Токен хранится в
// sessionStorage под тем же ключом, что уже использует public/js/branding.js
// (tamga_client_token:<slug>) — если человек уже вошёл на основном сайте в
// этой же вкладке, повторно пароль вводить не нужно.
//
// См. api/client-settings.js — тот же backend, что здесь дёргается.

import { DOC_TYPES } from '../js/config/docSchema.js';
import { createIdleSession } from '../js/idleSession.js';

const params = new URLSearchParams(window.location.search);
const slug = (params.get('client') || '').trim();
document.getElementById('backToApp').href = slug ? `/?client=${encodeURIComponent(slug)}` : '/';

const TOKEN_KEY_PREFIX = 'tamga_client_token:';
const session = slug ? createIdleSession(TOKEN_KEY_PREFIX + slug) : null;
function getToken() { return session ? session.get() : null; }
const logoutBtn = document.getElementById('logoutBtn');
logoutBtn.style.display = getToken() ? 'inline-flex' : 'none';
logoutBtn.addEventListener('click', () => {
  if (!session) return;
  document.documentElement.style.visibility = 'hidden';
  returnToClient();
});

const noSlugSection = document.getElementById('noSlug');
const loadError = document.getElementById('loadError');
const noPasswordSection = document.getElementById('noPassword');
const mainSection = document.getElementById('settingsMain');


const fDisplayName = document.getElementById('fDisplayName');
const fLogoUrl = document.getElementById('fLogoUrl');
const fAccentColor = document.getElementById('fAccentColor');
const colorSwatch = document.getElementById('colorSwatch');

const fieldOverridesList = document.getElementById('fieldOverridesList');
const addFieldOverrideBtn = document.getElementById('addFieldOverrideBtn');
const fieldOverrideEditor = document.getElementById('fieldOverrideEditor');
const overrideTypeSelect = document.getElementById('overrideTypeSelect');
const overrideFieldsInput = document.getElementById('overrideFieldsInput');
const confirmFieldOverrideBtn = document.getElementById('confirmFieldOverrideBtn');
const cancelFieldOverrideBtn = document.getElementById('cancelFieldOverrideBtn');

const customTypesList = document.getElementById('customTypesList');
const addCustomTypeBtn = document.getElementById('addCustomTypeBtn');
const customTypeEditor = document.getElementById('customTypeEditor');
const newTypeName = document.getElementById('newTypeName');
const newTypeFields = document.getElementById('newTypeFields');
const newTypeHint = document.getElementById('newTypeHint');
const confirmCustomTypeBtn = document.getElementById('confirmCustomTypeBtn');
const cancelCustomTypeBtn = document.getElementById('cancelCustomTypeBtn');

const businessRulesList = document.getElementById('businessRulesList');
const addBusinessRuleBtn = document.getElementById('addBusinessRuleBtn');
const businessRuleEditor = document.getElementById('businessRuleEditor');
const ruleType = document.getElementById('ruleType');
const ruleGroupPercentage = document.getElementById('ruleGroupPercentage');
const ruleGroupSum = document.getElementById('ruleGroupSum');
const ruleGroupDateOrder = document.getElementById('ruleGroupDateOrder');
const ruleGroupRequired = document.getElementById('ruleGroupRequired');
const ruleGroupRange = document.getElementById('ruleGroupRange');
const ruleGroupTolerance = document.getElementById('ruleGroupTolerance');
const ruleBaseField = document.getElementById('ruleBaseField');
const ruleValueField = document.getElementById('ruleValueField');
const ruleExpectedPercent = document.getElementById('ruleExpectedPercent');
const ruleSumFields = document.getElementById('ruleSumFields');
const ruleTargetField = document.getElementById('ruleTargetField');
const ruleEarlierField = document.getElementById('ruleEarlierField');
const ruleLaterField = document.getElementById('ruleLaterField');
const ruleRequiredField = document.getElementById('ruleRequiredField');
const ruleRangeField = document.getElementById('ruleRangeField');
const ruleRangeMin = document.getElementById('ruleRangeMin');
const ruleRangeMax = document.getElementById('ruleRangeMax');
const ruleTolerancePercent = document.getElementById('ruleTolerancePercent');
const ruleLevel = document.getElementById('ruleLevel');
const confirmBusinessRuleBtn = document.getElementById('confirmBusinessRuleBtn');
const cancelBusinessRuleBtn = document.getElementById('cancelBusinessRuleBtn');

const currentPasswordInput = document.getElementById('currentPasswordInput');
const newPasswordInput = document.getElementById('newPasswordInput');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const passwordChangeStatus = document.getElementById('passwordChangeStatus');
const passwordChangeError = document.getElementById('passwordChangeError');

const saveAllBtn = document.getElementById('saveAllBtn');
const saveStatus = document.getElementById('saveStatus');
const saveError = document.getElementById('saveError');

// Состояние формы — то же самое, что уходит в PATCH /api/client-settings при
// сохранении. editingX хранит, что именно сейчас редактируется (null — новая запись).
let state = { fieldOverrides: {}, customDocTypes: {}, businessRules: [] };
let editingOverrideType = null;
let editingCustomTypeName = null;
let editingBusinessRuleIndex = null;

function splitFields(text) {
  return text.split(',').map(s => s.trim()).filter(Boolean);
}

// --- Переопределение полей ---

function renderFieldOverridesList() {
  fieldOverridesList.innerHTML = '';
  Object.keys(state.fieldOverrides).forEach(type => {
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
    editBtn.addEventListener('click', () => openFieldOverrideEditor(type));
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

function openFieldOverrideEditor(existingType) {
  editingOverrideType = existingType || null;
  overrideTypeSelect.innerHTML = '';
  const usedTypes = Object.keys(state.fieldOverrides);
  DOC_TYPES.filter(t => t === existingType || !usedTypes.includes(t)).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    overrideTypeSelect.appendChild(opt);
  });
  overrideTypeSelect.value = existingType || overrideTypeSelect.options[0].value;
  overrideTypeSelect.disabled = !!existingType;
  overrideFieldsInput.value = existingType ? state.fieldOverrides[existingType].join(', ') : '';
  fieldOverrideEditor.style.display = 'block';
  fieldOverrideEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

addFieldOverrideBtn.addEventListener('click', () => {
  if (!DOC_TYPES.some(t => !Object.keys(state.fieldOverrides).includes(t))) {
    alert('Переопределения уже добавлены для всех стандартных типов документов.');
    return;
  }
  openFieldOverrideEditor(null);
});
cancelFieldOverrideBtn.addEventListener('click', () => { fieldOverrideEditor.style.display = 'none'; });
confirmFieldOverrideBtn.addEventListener('click', () => {
  const type = overrideTypeSelect.value;
  const fields = splitFields(overrideFieldsInput.value);
  if (!type || !fields.length) { alert('Выберите тип и укажите хотя бы одно поле.'); return; }
  state.fieldOverrides[type] = fields;
  fieldOverrideEditor.style.display = 'none';
  renderFieldOverridesList();
});

// --- Свои типы документов ---

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
    entry.fields.forEach(f => {
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

function openCustomTypeEditor(existingName) {
  editingCustomTypeName = existingName || null;
  newTypeName.value = existingName || '';
  newTypeName.disabled = !!existingName;
  const entry = existingName ? state.customDocTypes[existingName] : null;
  newTypeFields.value = entry ? entry.fields.join(', ') : '';
  newTypeHint.value = entry && entry.hint ? entry.hint : '';
  customTypeEditor.style.display = 'block';
  customTypeEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

addCustomTypeBtn.addEventListener('click', () => openCustomTypeEditor(null));
cancelCustomTypeBtn.addEventListener('click', () => { customTypeEditor.style.display = 'none'; });
confirmCustomTypeBtn.addEventListener('click', () => {
  const name = newTypeName.value.trim();
  const fields = splitFields(newTypeFields.value);
  if (!name || !fields.length) { alert('Укажите название типа и хотя бы одно поле.'); return; }
  if (DOC_TYPES.includes(name)) { alert('Это название совпадает со стандартным типом документа — используйте «Переопределение полей» вместо создания нового типа.'); return; }
  if (!editingCustomTypeName && state.customDocTypes[name]) { alert('Тип с таким названием уже есть.'); return; }
  if (editingCustomTypeName && editingCustomTypeName !== name) delete state.customDocTypes[editingCustomTypeName];
  state.customDocTypes[name] = { fields };
  if (newTypeHint.value.trim()) state.customDocTypes[name].hint = newTypeHint.value.trim();
  customTypeEditor.style.display = 'none';
  renderCustomTypesList();
});

// --- Бизнес-правила (5 готовых типов, Ethan 8 сен 2026) ---

function ruleSummaryText(rule) {
  const levelLabel = rule.level === 'info' ? 'информация' : 'ошибка';
  switch (rule.type) {
    case 'percentage_match':
      return `«${rule.valueField}» ≈ ${rule.expectedPercent}% от «${rule.baseField}» (допуск ±${rule.tolerancePercent ?? 1}, уровень: ${levelLabel})`;
    case 'sum_match':
      return `Сумма «${rule.sumFields.join('», «')}» ≈ «${rule.targetField}» (допуск ±${rule.tolerancePercent ?? 1}, уровень: ${levelLabel})`;
    case 'date_order':
      return `«${rule.earlierField}» не позже «${rule.laterField}» (уровень: ${levelLabel})`;
    case 'required_field':
      return `«${rule.field}» обязательно для заполнения (уровень: ${levelLabel})`;
    case 'range_check': {
      const bounds = [rule.min != null ? `от ${rule.min}` : null, rule.max != null ? `до ${rule.max}` : null].filter(Boolean).join(' ');
      return `«${rule.field}» ${bounds} (уровень: ${levelLabel})`;
    }
    default:
      return rule.type;
  }
}

function renderBusinessRulesList() {
  businessRulesList.innerHTML = '';
  state.businessRules.forEach((rule, index) => {
    const item = document.createElement('div');
    item.className = 'admin-override-item';
    const main = document.createElement('div');
    main.className = 'admin-override-item-main';
    const title = document.createElement('div');
    title.className = 'admin-override-item-title';
    title.textContent = ruleSummaryText(rule);
    main.appendChild(title);
    item.appendChild(main);

    const btns = document.createElement('div');
    const editBtn = document.createElement('button');
    editBtn.className = 'admin-link-btn';
    editBtn.textContent = 'Изменить';
    editBtn.style.marginRight = '10px';
    editBtn.addEventListener('click', () => openBusinessRuleEditor(index));
    const removeBtn = document.createElement('button');
    removeBtn.className = 'admin-override-item-remove';
    removeBtn.textContent = 'Удалить';
    removeBtn.addEventListener('click', () => { state.businessRules.splice(index, 1); renderBusinessRulesList(); });
    btns.appendChild(editBtn);
    btns.appendChild(removeBtn);
    item.appendChild(btns);

    businessRulesList.appendChild(item);
  });
}

// Показывает только группу полей, относящуюся к выбранному типу правила —
// остальные скрыты, чтобы не путать пустыми несвязанными полями.
function updateRuleGroupVisibility() {
  const type = ruleType.value;
  ruleGroupPercentage.style.display = type === 'percentage_match' ? 'block' : 'none';
  ruleGroupSum.style.display = type === 'sum_match' ? 'block' : 'none';
  ruleGroupDateOrder.style.display = type === 'date_order' ? 'block' : 'none';
  ruleGroupRequired.style.display = type === 'required_field' ? 'block' : 'none';
  ruleGroupRange.style.display = type === 'range_check' ? 'block' : 'none';
  // Допуск относится только к правилам, которые сравнивают числа приблизительно.
  ruleGroupTolerance.style.display = (type === 'percentage_match' || type === 'sum_match') ? 'block' : 'none';
}
ruleType.addEventListener('change', updateRuleGroupVisibility);

function openBusinessRuleEditor(existingIndex) {
  editingBusinessRuleIndex = existingIndex != null ? existingIndex : null;
  const existing = existingIndex != null ? state.businessRules[existingIndex] : null;

  ruleType.value = existing ? existing.type : 'percentage_match';
  ruleType.disabled = !!existing; // при редактировании тип не меняем — проще создать заново, чем переносить поля между формами
  ruleLevel.value = existing ? (existing.level || 'error') : 'error';

  ruleBaseField.value = existing && existing.type === 'percentage_match' ? existing.baseField : '';
  ruleValueField.value = existing && existing.type === 'percentage_match' ? existing.valueField : '';
  ruleExpectedPercent.value = existing && existing.type === 'percentage_match' ? existing.expectedPercent : '';
  ruleSumFields.value = existing && existing.type === 'sum_match' ? existing.sumFields.join(', ') : '';
  ruleTargetField.value = existing && existing.type === 'sum_match' ? existing.targetField : '';
  ruleEarlierField.value = existing && existing.type === 'date_order' ? existing.earlierField : '';
  ruleLaterField.value = existing && existing.type === 'date_order' ? existing.laterField : '';
  ruleRequiredField.value = existing && existing.type === 'required_field' ? existing.field : '';
  ruleRangeField.value = existing && existing.type === 'range_check' ? existing.field : '';
  ruleRangeMin.value = existing && existing.type === 'range_check' && existing.min != null ? existing.min : '';
  ruleRangeMax.value = existing && existing.type === 'range_check' && existing.max != null ? existing.max : '';
  ruleTolerancePercent.value = existing && existing.tolerancePercent != null ? existing.tolerancePercent : '';

  updateRuleGroupVisibility();
  businessRuleEditor.style.display = 'block';
  businessRuleEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

addBusinessRuleBtn.addEventListener('click', () => openBusinessRuleEditor(null));
cancelBusinessRuleBtn.addEventListener('click', () => { businessRuleEditor.style.display = 'none'; });
confirmBusinessRuleBtn.addEventListener('click', () => {
  const type = ruleType.value;
  const level = ruleLevel.value;
  const tolerancePercent = ruleTolerancePercent.value.trim() ? Number(ruleTolerancePercent.value) : 1;
  let rule = null;

  if (type === 'percentage_match') {
    const baseField = ruleBaseField.value.trim();
    const valueField = ruleValueField.value.trim();
    const expectedPercent = Number(ruleExpectedPercent.value);
    if (!baseField || !valueField || !ruleExpectedPercent.value.trim() || !Number.isFinite(expectedPercent)) {
      alert('Укажите поле-базу, проверяемое поле и ожидаемый процент (число).');
      return;
    }
    rule = { type, baseField, valueField, expectedPercent, tolerancePercent, level };
  } else if (type === 'sum_match') {
    const sumFields = splitFields(ruleSumFields.value);
    const targetField = ruleTargetField.value.trim();
    if (!sumFields.length || !targetField) {
      alert('Укажите хотя бы одно складываемое поле и итоговое поле.');
      return;
    }
    rule = { type, sumFields, targetField, tolerancePercent, level };
  } else if (type === 'date_order') {
    const earlierField = ruleEarlierField.value.trim();
    const laterField = ruleLaterField.value.trim();
    if (!earlierField || !laterField) {
      alert('Укажите оба поля-даты.');
      return;
    }
    rule = { type, earlierField, laterField, level };
  } else if (type === 'required_field') {
    const field = ruleRequiredField.value.trim();
    if (!field) { alert('Укажите поле.'); return; }
    rule = { type, field, level };
  } else if (type === 'range_check') {
    const field = ruleRangeField.value.trim();
    const hasMin = ruleRangeMin.value.trim() !== '';
    const hasMax = ruleRangeMax.value.trim() !== '';
    if (!field || (!hasMin && !hasMax)) {
      alert('Укажите поле и хотя бы одну границу (минимум или максимум).');
      return;
    }
    rule = { type, field, min: hasMin ? Number(ruleRangeMin.value) : null, max: hasMax ? Number(ruleRangeMax.value) : null, level };
  }

  if (editingBusinessRuleIndex != null) state.businessRules[editingBusinessRuleIndex] = rule;
  else state.businessRules.push(rule);
  businessRuleEditor.style.display = 'none';
  renderBusinessRulesList();
});

// --- Загрузка/сохранение ---

function applyLoadedConfig(data) {
  state = {
    fieldOverrides: data.fieldOverrides ? JSON.parse(JSON.stringify(data.fieldOverrides)) : {},
    customDocTypes: data.customDocTypes ? JSON.parse(JSON.stringify(data.customDocTypes)) : {},
    businessRules: Array.isArray(data.businessRules) ? JSON.parse(JSON.stringify(data.businessRules)) : []
  };
  fDisplayName.value = data.displayName || '';
  fLogoUrl.value = data.logoUrl || '';
  fAccentColor.value = data.accentColor || '';
  colorSwatch.style.background = data.accentColor || 'var(--accent)';
  renderFieldOverridesList();
  renderCustomTypesList();
  renderBusinessRulesList();
}

fAccentColor.addEventListener('input', () => {
  colorSwatch.style.background = /^#[0-9a-fA-F]{6}$/.test(fAccentColor.value.trim()) ? fAccentColor.value.trim() : 'var(--accent)';
});

async function fetchSettings(token) {
  const res = await fetch(`/api/client-settings?slug=${encodeURIComponent(slug)}`, {
    headers: token ? { 'x-client-token': token } : {}
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function saveSettings() {
  saveError.style.display = 'none';
  saveAllBtn.disabled = true;
  saveStatus.textContent = 'Сохраняем…';
  try {
    const payload = {
      field_overrides: Object.keys(state.fieldOverrides).length ? state.fieldOverrides : null,
      custom_doc_types: Object.keys(state.customDocTypes).length ? state.customDocTypes : null,
      business_rules: state.businessRules,
      display_name: fDisplayName.value.trim() || null,
      logo_url: fLogoUrl.value.trim() || null,
      accent_color: fAccentColor.value.trim() || null
    };
    const res = await fetch(`/api/client-settings?slug=${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-client-token': getToken() },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      saveError.textContent = body.error || 'Не удалось сохранить';
      saveError.style.display = 'block';
      saveStatus.textContent = '';
      return;
    }
    applyLoadedConfig(body);
    saveStatus.textContent = 'Сохранено ✓';
    setTimeout(() => { saveStatus.textContent = ''; }, 3000);
  } catch (err) {
    saveError.textContent = 'Не удалось связаться с сервером, попробуйте ещё раз';
    saveError.style.display = 'block';
    saveStatus.textContent = '';
  } finally {
    saveAllBtn.disabled = false;
  }
}
saveAllBtn.addEventListener('click', saveSettings);

// --- Смена пароля (Ethan, 8 сен 2026: "чтобы он сам мог менять пароль") —
// отдельный запрос от сохранения остальных настроек (см. api/client-settings.js:
// требует текущий пароль, не полагается только на валидный токен сессии).
changePasswordBtn.addEventListener('click', async () => {
  passwordChangeError.style.display = 'none';
  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  if (!currentPassword || !newPassword) {
    passwordChangeError.textContent = 'Заполните оба поля';
    passwordChangeError.style.display = 'block';
    return;
  }
  changePasswordBtn.disabled = true;
  passwordChangeStatus.textContent = 'Меняем…';
  try {
    const res = await fetch(`/api/client-settings?slug=${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-client-token': getToken() },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      passwordChangeError.textContent = body.error || 'Не удалось сменить пароль';
      passwordChangeError.style.display = 'block';
      passwordChangeStatus.textContent = '';
      return;
    }
    currentPasswordInput.value = '';
    newPasswordInput.value = '';
    passwordChangeStatus.textContent = 'Пароль изменён ✓';
    setTimeout(() => { passwordChangeStatus.textContent = ''; }, 3000);
  } catch (err) {
    passwordChangeError.textContent = 'Не удалось связаться с сервером, попробуйте ещё раз';
    passwordChangeError.style.display = 'block';
    passwordChangeStatus.textContent = '';
  } finally {
    changePasswordBtn.disabled = false;
  }
});

// --- Вход и первичная загрузка ---

function returnToClient() {
  session.clear();
  mainSection.style.display = 'none';
  window.location.replace(`/?client=${encodeURIComponent(slug)}`);
}

async function loadAndShow(token) {
  const { ok, status, body } = await fetchSettings(token);
  if (ok) {
    noPasswordSection.style.display = 'none';
    mainSection.style.display = 'block';
    applyLoadedConfig(body);
    return;
  }
  mainSection.style.display = 'none';
  if (status === 403) {
    // Пароль для этого клиента вообще не задан — самообслуживание недоступно
    // (см. lib/clientAuth.js:requireClientSettingsAuth — сознательно строже
    // обычного гейта сайта).
    noPasswordSection.style.display = 'block';
    return;
  }
  if (status === 401) returnToClient();
  else loadError.style.display = 'block';
}

async function init() {
  if (!slug) {
    noSlugSection.style.display = 'block';
    return;
  }
  try {
    await loadAndShow(getToken());
  } catch (_) {
    loadError.style.display = 'block';
  }
}

init();
