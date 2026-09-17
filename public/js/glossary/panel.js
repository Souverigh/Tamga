// public/js/glossary/panel.js — вкладка "Глоссарий" (Ethan, 17 сен 2026:
// "сделать глоссарий доступным для клиентов, чтобы они могли поправить").
//
// Раньше клиент мог поправить транслитерацию только в моменте — открыв окно
// сравнения переведённого документа (public/js/translationDocs/panel.js,
// та же правка уходит в глоссарий через /api/transliterations action=confirm,
// см. коммит 17 сен). Здесь — отдельная страница: клиент видит уже
// накопленный глоссарий (личные термины + общий дефолт по большинству,
// lib/verifiedTransliterations.js) ДО перевода следующего документа и может
// поправить термин заранее, не дожидаясь, пока он всплывёт в файле.
//
// По образцу public/js/translationDocs/panel.js/accounting/panel.js: DOM
// строится в JS, показывается только платным клиентам (slug+token),
// переиспользует общий таб-бар (contentTabs.js) и .admin-table/.acct-*
// классы из accounting.css — отдельного CSS-файла эта вкладка не заводит.

import { getClientSlug, getClientToken } from '../branding.js';
import { registerTab } from '../contentTabs.js';

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (text, cls) => { const b = el('button', text, cls); b.type = 'button'; return b; };
const PAGE_SIZE = 50;

function panelIcon() {
  const icon = el('div', null, 'acct-panel-icon');
  icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/></svg>';
  return icon;
}

async function callApi(payload) {
  const token = getClientToken();
  const res = await fetch('/api/transliterations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-client-token': token } : {}) },
    body: JSON.stringify({ clientSlug: getClientSlug(), ...payload })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Ошибка запроса.');
  return data;
}

export async function initGlossaryPanel() {
  const slug = getClientSlug(), token = getClientToken();
  if (!slug || !token) return; // не платный клиент с паролем — вкладка не показывается

  const root = el('section', null, 'panel acct-wrap');
  root.id = 'glossaryPanel';

  const panelHeader = el('div', null, 'acct-panel-header');
  const panelTitle = el('div', null, 'acct-panel-header-title');
  panelTitle.append(panelIcon(), el('h2', 'Глоссарий'));
  panelHeader.append(panelTitle);
  root.append(panelHeader);
  root.append(el('p',
    'Как переводятся ФИО и топонимы в ваших документах. У каждого термина — общее значение (его видят все новые клиенты) и, если вы его правили, ваш личный вариант — он важнее общего именно в ваших переводах. Если ваш вариант позже выберет большинство клиентов, он сам станет общим.',
    'admin-note'));

  if (!registerTab('glossary', 'Глоссарий', root)) return;

  const toolbar = el('div', null, 'acct-export-toolbar');
  toolbar.style.alignItems = 'flex-end';
  const searchField = el('div', null, 'translation-field');
  searchField.style.flex = '1 1 260px';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Поиск по оригиналу или переводу…';
  searchInput.setAttribute('aria-label', 'Поиск по глоссарию');
  searchField.append(searchInput);
  const addBtn = button('Добавить термин', 'btn-secondary');
  toolbar.append(searchField, addBtn);
  root.append(toolbar);

  const errorBox = el('div', null, 'admin-error'); errorBox.style.display = 'none';
  root.append(errorBox);

  const table = el('table', null, 'admin-table');
  table.innerHTML = '<thead><tr><th>Оригинал</th><th>Мой вариант</th><th>Общий (по умолчанию)</th><th></th></tr></thead>';
  const tbody = el('tbody');
  table.append(tbody);
  root.append(table);

  const emptyNote = el('p', 'Пока пусто — термины появятся здесь после первого перевода документа с именами/топонимами, либо добавьте нужный термин вручную кнопкой выше.', 'admin-note');
  emptyNote.style.display = 'none';
  root.append(emptyNote);

  const loadMoreWrap = el('div'); loadMoreWrap.style.marginTop = '10px'; loadMoreWrap.style.display = 'none';
  const loadMoreBtn = button('Показать ещё', 'btn-secondary');
  loadMoreWrap.append(loadMoreBtn);
  root.append(loadMoreWrap);

  let offset = 0;
  let currentSearch = '';
  let loadToken = 0;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = message ? '' : 'none';
  }

  function makeRow(item) {
    const row = el('tr');
    row.append(el('td', item.original));

    const mineCell = el('td');
    const mineInput = document.createElement('input');
    mineInput.value = item.clientValue ?? '';
    mineInput.placeholder = item.globalValue || '';
    mineInput.setAttribute('aria-label', `Мой вариант для «${item.original}»`);
    mineCell.append(mineInput);
    row.append(mineCell);

    row.append(el('td', item.globalValue || '—', 'admin-note'));

    const actionCell = el('td');
    const saveBtn = button('Сохранить', 'btn-secondary');
    const status = el('span', '', 'admin-note');
    status.style.marginLeft = '8px';
    saveBtn.addEventListener('click', async () => {
      const value = mineInput.value.trim();
      if (!value) { status.textContent = 'Введите значение.'; return; }
      saveBtn.disabled = true; status.textContent = 'Сохраняем…';
      try {
        await callApi({ action: 'confirm', entries: [{ original: item.original, verifiedValue: value }] });
        item.clientValue = value;
        status.textContent = 'Сохранено';
        setTimeout(() => { status.textContent = ''; }, 2000);
      } catch (err) {
        status.textContent = err.message || 'Не удалось сохранить.';
      } finally {
        saveBtn.disabled = false;
      }
    });
    actionCell.append(saveBtn, status);
    row.append(actionCell);
    return row;
  }

  async function load({ reset = false } = {}) {
    if (reset) { offset = 0; tbody.innerHTML = ''; }
    const token = ++loadToken;
    showError('');
    loadMoreBtn.disabled = true;
    try {
      const data = await callApi({ action: 'list', search: currentSearch, offset });
      if (token !== loadToken) return; // устаревший ответ — искали/грузили заново
      const items = Array.isArray(data.items) ? data.items : [];
      items.forEach(item => tbody.append(makeRow(item)));
      offset += items.length;
      const total = Number.isFinite(data.total) ? data.total : offset;
      loadMoreWrap.style.display = offset < total && items.length ? '' : 'none';
      emptyNote.style.display = offset === 0 ? '' : 'none';
      table.style.display = offset === 0 ? 'none' : '';
    } catch (err) {
      if (token !== loadToken) return;
      showError(err.message || 'Глоссарий временно недоступен.');
    } finally {
      if (token === loadToken) loadMoreBtn.disabled = false;
    }
  }

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentSearch = searchInput.value.trim(); load({ reset: true }); }, 300);
  });
  loadMoreBtn.addEventListener('click', () => load());

  addBtn.addEventListener('click', async () => {
    const original = window.prompt('Оригинал (как в документе, кириллицей):');
    if (!original || !original.trim()) return;
    const value = window.prompt(`Перевод/транслитерация для «${original.trim()}»:`);
    if (!value || !value.trim()) return;
    try {
      await callApi({ action: 'confirm', entries: [{ original: original.trim(), verifiedValue: value.trim() }] });
      load({ reset: true });
    } catch (err) {
      showError(err.message || 'Не удалось добавить термин.');
    }
  });

  load({ reset: true });
}
