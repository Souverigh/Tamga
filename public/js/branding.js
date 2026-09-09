// White-label фасад для клиентских пилотов (см. хендовер про вариант Б —
// один код и деплой, клиент определяется по slug, а не форк на каждого).
//
// Клиент определяется только через ?client=acme. Главная без параметра — бесплатная.
//
// Гейт паролем (см. lib/clientAuth.js, /admin): если у клиента задан пароль,
// /api/client-config отвечает 401 {gateRequired:true} без фасада — вместо
// применения фасада показываем оверлей #clientGate (см. index.html), сайт
// целиком скрыт до этого момента через html.tamga-gate-pending (анти-флэш
// инлайн-скрипт в <head>, см. index.html — здесь мы только снимаем этот класс
// после успешной проверки, скрипт в head его только ставит). Токен после
// успешного пароля живёт в sessionStorage (переживает только вкладку) —
// ключ включает slug, т.к. в одной вкладке теоретически можно сменить ?client=.
//
// Без slug (обычный пользователь сайта) — ничего не меняется, applyBranding
// просто не находит конфиг и оставляет вид по умолчанию (см. api/client-config.js:
// пустой slug/ненайденная запись — это нормальный случай, не ошибка).

import { setExtraDocTypes } from './ui/fileList.js';
import { createIdleSession } from './idleSession.js';

const TOKEN_KEY_PREFIX = 'tamga_client_token:';

// Кэш последнего успешно загруженного конфига клиента — визуальный фасад
// (displayName/logoUrl/accentColor, нужен export/pdfExport.js и export/xlsxExport.js
// через app.js для брендированного экспорта) И лимит приоритетной обработки
// (maxConcurrency — премиум-опция, см. app.js) в одном объекте, т.к. оба
// приходят одним и тем же запросом к /api/client-config — нет смысла делать
// второй запрос ради ещё одного числа. null, пока конфиг не загрузился (или
// его нет вовсе — обычный посетитель без slug).
let cachedBranding = null;

// Используется export-модулями (см. app.js) для брендированного экспорта —
// логотип/название клиента в PDF, название компании в свойствах Excel — И
// самим app.js для приоритетной обработки (maxConcurrency, см. комментарий
// у MAX_CONCURRENT_REQUESTS там). Не гарантирует, что конфиг уже загрузился
// (initBranding — fire-and-forget, см. вызов в app.js) — на момент фактического
// клика "Распознать"/"Скачать" он почти наверняка успеет (человек сначала
// выбирает файлы), но вызывающий код должен быть готов к null и просто
// использовать значения по умолчанию в этом случае.
export function getClientBranding() {
  return cachedBranding;
}

function resolveClientSlug() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('client') || '').trim() || null;
}

function renderClientPlan(slug, config) {
  const settings = document.getElementById('settingsLink');
  const free = document.getElementById('freeLimitNote');
  const usage = document.getElementById('planUsageNote');
  const isClient = !!(slug && config && config.isClient);
  const canOpenSettings = !!slug && (slug === 'admin' || isClient);
  if (settings) {
    settings.style.display = canOpenSettings ? 'inline-flex' : 'none';
    if (canOpenSettings) settings.href = `/settings/?client=${encodeURIComponent(slug)}`;
  }
  if (free) free.style.display = isClient || slug === 'admin' ? 'none' : 'block';
  if (usage) {
    usage.style.display = isClient ? 'block' : 'none';
    if (isClient) {
      usage.textContent = config.pageLimit == null
        ? 'Тариф: безлимитный.'
        : `Осталось ${Math.max(0, config.pageLimit - config.pagesUsed)} из ${config.pageLimit} страниц по тарифу.`;
    }
  }
}

export async function refreshClientUsage() {
  const slug = resolveClientSlug();
  if (!slug) return;
  try {
    const { ok, config } = await fetchClientConfig(slug, getClientToken());
    if (ok) renderClientPlan(slug, config);
  } catch (_) {
    const usage = document.getElementById('planUsageNote');
    if (usage) usage.textContent = 'Не удалось обновить остаток страниц. Обновите страницу.';
  }
}

// Используется geminiRecognizeClient.js, чтобы приложить slug к каждому запросу
// распознавания — так сервер знает, чей это конфиг (кастомные поля/типы/формат).
export function getClientSlug() {
  return resolveClientSlug();
}

// Токен гейта (см. lib/clientAuth.js) — null, если у клиента нет пароля или
// он ещё не введён в этой вкладке. Прикладывается geminiRecognizeClient.js
// заголовком x-client-token к /api/recognize (см. app.js) — без него сервер
// откажет в распознавании для защищённого паролем slug, даже если сайт
// как-то обошли (см. api/recognize.js:checkClientGate).
export function getClientToken() {
  const slug = resolveClientSlug();
  return slug ? createIdleSession(TOKEN_KEY_PREFIX + slug).get() : null;
}

function applyFacade(config) {
  if (!config) return;
  if (config.displayName) {
    const brandEl = document.querySelector('.brand');
    if (brandEl) {
      // Печать оставляем как есть — просто заменяем текстовый узел после иконки-печати,
      // чтобы не терять оформление .seal (см. styles.css).
      const seal = brandEl.querySelector('.seal');
      brandEl.textContent = '';
      if (seal) brandEl.appendChild(seal);
      brandEl.appendChild(document.createTextNode(config.displayName));
    }
    document.title = document.title.replace('АДРЕ', config.displayName);
  }
  if (config.accentColor) {
    document.documentElement.style.setProperty('--accent', config.accentColor);
  }
  if (config.logoUrl) {
    const seal = document.querySelector('.brand .seal');
    if (seal) {
      seal.innerHTML = '';
      const img = document.createElement('img');
      img.src = config.logoUrl;
      img.alt = config.displayName || 'логотип';
      img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:inherit;';
      seal.appendChild(img);
    }
  }
}

// Снимает анти-флэш класс (см. index.html) — открывает #appRoot. Вызывается
// и когда гейта нет вообще, и после успешного пароля.
function revealApp() {
  document.documentElement.classList.remove('tamga-gate-pending');
}

// Запрашивает фасад клиента с сервера. token передаём, только если он уже
// есть (первый заход без пароля ещё введённого — без заголовка, сервер сам
// скажет, нужен ли он вообще, см. api/client-config.js).
async function fetchClientConfig(slug, token) {
  const headers = token ? { 'x-client-token': token } : {};
  const res = await fetch(`/api/client-config?slug=${encodeURIComponent(slug)}`, { headers });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, gateRequired: !!body.gateRequired, config: res.ok ? body : null };
}

function applyCustomDocTypes(config) {
  // Кастомные типы клиента — не только для авто-классификации (уже работает
  // через lib/classification.js на сервере), но и для ручного выбора в
  // выпадающем списке, если человек включит «Указать тип документа вручную»
  // (см. fileList.js: manualTypeToggle).
  if (config.customDocTypeNames && config.customDocTypeNames.length) {
    setExtraDocTypes(config.customDocTypeNames);
  }
}

// Показывает оверлей пароля и ждёт успешного входа — оборачивает обработчики
// формы в промис, чтобы initBranding мог просто await'нуть результат.
function showGate(slug) {
  const gate = document.getElementById('clientGate');
  const input = document.getElementById('clientGatePassword');
  const btn = document.getElementById('clientGateBtn');
  const errorEl = document.getElementById('clientGateError');

  gate.style.display = 'flex';
  input.focus();

  return new Promise(resolve => {
    async function trySubmit() {
      const password = input.value;
      if (!password) return;
      errorEl.style.display = 'none';
      btn.disabled = true;
      try {
        const res = await fetch('/api/client-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientSlug: slug, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) {
          errorEl.textContent = data.error || 'Неверный пароль';
          errorEl.style.display = 'block';
          btn.disabled = false;
          return;
        }
        createIdleSession(TOKEN_KEY_PREFIX + slug).set(data.token);
        input.value = '';
        gate.style.display = 'none';
        resolve(data.token);
      } catch (err) {
        errorEl.textContent = 'Не удалось связаться с сервером, попробуйте ещё раз';
        errorEl.style.display = 'block';
        btn.disabled = false;
      }
    }
    btn.addEventListener('click', trySubmit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') trySubmit(); });
  });
}

// Вызывается один раз при загрузке страницы (см. app.js). Для обычного
// посетителя (без slug) — сразу открывает страницу и выходит. Для slug с
// паролем — держит страницу скрытой (см. html.tamga-gate-pending в index.html)
// до успешного ввода пароля, ТОЛЬКО ПОТОМ открывает и применяет фасад.
// Fail-open в части самого фасада (сбой сети — просто вид по умолчанию), но
// НЕ в части пароля: если сервер явно сказал gateRequired — страница
// открывается не раньше валидного пароля, ни при каких сетевых сбоях.
export async function initBranding() {
  const slug = resolveClientSlug();
  renderClientPlan(slug, null);
  if (!slug) { revealApp(); return; }

  try {
    let token = getClientToken();
    let { ok, gateRequired, config } = await fetchClientConfig(slug, token);

    if (gateRequired) {
      token = await showGate(slug); // ждём, пока человек не введёт верный пароль
      ({ ok, gateRequired, config } = await fetchClientConfig(slug, token));
    }

    revealApp();
    if (ok && config) {
      renderClientPlan(slug, config);
      applyFacade(config);
      applyCustomDocTypes(config);
      // Только безопасные для браузера поля — то же самое, что уже отдал
      // /api/client-config (см. его комментарий: намеренно НЕ полный конфиг).
      cachedBranding = {
        displayName: config.displayName || null,
        logoUrl: config.logoUrl || null,
        accentColor: config.accentColor || null,
        // Число или null — см. api/client-config.js и lib/customFieldsLookup.js.
        maxConcurrency: typeof config.maxConcurrency === 'number' ? config.maxConcurrency : null,
        // Настраиваемые бизнес-правила (Ethan, 7 сен 2026) — используются
        // в public/js/ui/results.js:checkBusinessRules, см. комментарий там.
        businessRules: Array.isArray(config.businessRules) ? config.businessRules : []
      };
    }
  } catch (err) {
    // Сетевой сбой на этапе, когда гейт ещё не подтверждён точно не нужен —
    // открываем страницу с видом по умолчанию, как обычный посетитель, а не
    // держим человека перед вечно крутящимся экраном из-за временного сбоя сети.
    console.error('branding: не удалось загрузить конфиг клиента, используем вид по умолчанию:', err.message);
    revealApp();
  }
}
