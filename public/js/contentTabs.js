// public/js/contentTabs.js — общий контроллер верхних табов над основным
// потоком (#recognizeFlow), вынесен из public/js/accounting/panel.js 16 сен
// 2026, когда Ethan попросил такую же отдельную вкладку для модуля перевода
// (public/js/translationDocs/panel.js) — раньше таб-бар строила только
// бухгалтерия и умела показывать ровно 2 вкладки ("Распознавание"/
// "Бухгалтерия"), жёстко зашитые в одном модуле. Теперь любой модуль,
// показывающий платному клиенту свою отдельную панель, зовёт registerTab()
// и получает третью (и далее) вкладку бесплатно, без знания друг о друге.
//
// Порядок вкладок = порядок вызовов registerTab() (app.js решает порядок
// через порядок initAccounting()/initTranslationDocs()). Первый вызов сам
// создаёт таб-бар и вкладку "Распознавание" (#recognizeFlow), поэтому не
// важно, какой модуль вызовет registerTab() первым — переключатель
// появляется лениво, при первой реальной надобности (платный клиент с
// доступом хотя бы к одной премиум-панели), а не всегда.
//
// Классы .acct-tabs/.acct-tab/.acct-tab-active определены в
// public/css/accounting.css — имя сохранено (не .content-tabs), чтобы не
// трогать уже задеплоенные стили ради переименования без функциональной
// причины; файл явно комментирует, что теперь используется не только
// бухгалтерией.

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (text, cls) => { const b = el('button', text, cls); b.type = 'button'; return b; };

let tabsNav = null;
const tabs = new Map(); // id -> { button, panel }

function activate(id) {
  for (const [key, entry] of tabs) {
    const active = key === id;
    entry.panel.style.display = active ? '' : 'none';
    entry.button.classList.toggle('acct-tab-active', active);
    entry.button.setAttribute('aria-selected', String(active));
  }
}

function ensureTabs() {
  if (tabsNav) return tabsNav;
  const recognizeFlow = document.getElementById('recognizeFlow');
  if (!recognizeFlow) return null; // защитно — без обёртки переключать нечего

  tabsNav = el('nav', null, 'acct-tabs');
  tabsNav.setAttribute('role', 'tablist');
  const recognizeTab = button('Распознавание', 'acct-tab acct-tab-active');
  recognizeTab.setAttribute('role', 'tab');
  recognizeTab.setAttribute('aria-selected', 'true');
  recognizeTab.addEventListener('click', () => activate('recognize'));
  tabsNav.append(recognizeTab);
  recognizeFlow.before(tabsNav);
  tabs.set('recognize', { button: recognizeTab, panel: recognizeFlow });
  return tabsNav;
}

// panelEl — корневой элемент новой вкладки; этот модуль сам вставляет его
// перед #recognizeFlow и управляет его display, вызывающему коду не нужно
// делать recognizeFlow.before(panelEl)/root.style.display самостоятельно.
export function registerTab(id, label, panelEl) {
  const nav = ensureTabs();
  if (!nav) return null;

  const tab = button(label, 'acct-tab');
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');
  tab.addEventListener('click', () => activate(id));
  nav.append(tab);

  panelEl.style.display = 'none';
  const recognizeFlow = document.getElementById('recognizeFlow');
  recognizeFlow.before(panelEl);

  tabs.set(id, { button: tab, panel: panelEl });
  return { activate: () => activate(id) };
}
