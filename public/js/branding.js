// White-label фасад для клиентских пилотов (см. хендовер про вариант Б —
// один код и деплой, клиент определяется по slug, а не форк на каждого).
//
// Slug приходит через ?client=acme в URL один раз, дальше живёт в localStorage —
// клиенту не нужно каждый раз давать ссылку с параметром, достаточно один раз
// открыть по ссылке с ?client=, дальше сайт сам помнит, кто это.
//
// Без slug (обычный пользователь сайта) — ничего не меняется, applyBranding
// просто не находит конфиг и оставляет вид по умолчанию (см. api/client-config.js:
// пустой slug/ненайденная запись — это нормальный случай, не ошибка).

const STORAGE_KEY = 'tamga_client_slug';

function resolveClientSlug() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('client');
  if (fromUrl) {
    localStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(STORAGE_KEY) || null;
}

// Используется geminiRecognizeClient.js, чтобы приложить slug к каждому запросу
// распознавания — так сервер знает, чей это конфиг (кастомные поля/типы/формат).
export function getClientSlug() {
  return resolveClientSlug();
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
    document.title = document.title.replace('Тамга', config.displayName);
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

// Вызывается один раз при загрузке страницы (см. app.js). Fail-open: сбой сети
// или отсутствие конфига просто оставляет вид по умолчанию — не блокирует
// остальную инициализацию приложения.
export async function initBranding() {
  const slug = resolveClientSlug();
  if (!slug) return;

  try {
    const res = await fetch(`/api/client-config?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return;
    const config = await res.json();
    applyFacade(config);
  } catch (err) {
    console.error('branding: не удалось загрузить конфиг клиента, используем вид по умолчанию:', err.message);
  }
}
