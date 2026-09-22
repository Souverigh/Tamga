// Пользователи внутри одного клиента (Ethan, 17 сен 2026: "внутри клиента
// можно создать пользователей с разными ролями, свой логин/пароль") —
// таблица tamga_client_users, отдельная от tamga_api_key_fields (там —
// сам клиент/сайт, здесь — конкретные люди внутри него).
//
// Пока у клиента нет ни одной строки здесь — вход работает как раньше, один
// общий пароль (access_password_hash на клиенте). Как только появляется
// хотя бы один пользователь — вход требует логин+пароль именно пользователя
// (см. lib/clientAuth.js:resolveClientAuth). Роли: 'owner' (все настройки,
// управление пользователями) и 'translator' (только распознавание/перевод/
// экспорт, своё ФИО подставляется автоматически, без доступа к настройкам).
//
// Тот же fail-open/кэш-приём, что lib/customFieldsLookup.js: недоступность
// Supabase не должна ронять сам сайт для клиентов БЕЗ пользователей (тогда
// просто нечего искать); для клиентов С пользователями сбой означает "вход
// невозможен" — это единственно безопасный fail-CLOSED вариант для гейта.

// certification — личный вариант приписки переводчика (Ethan, 21 сен 2026),
// см. supabase/migrations/202609211100_tamga_client_user_certification.sql.
const SELECT_COLUMNS = 'id,client_slug,username,password_hash,role,translator_name,certification,created_at,updated_at';
const CACHE_TTL_MS = 60 * 1000;
const userCache = new Map(); // `${client_slug}:${username}` -> { value: row|null, expiresAt }
const hasUsersCache = new Map(); // client_slug -> { value: boolean, expiresAt }

function supabaseCreds() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supabaseUrl && serviceKey ? { supabaseUrl, serviceKey } : null;
}

function headers(serviceKey, extra) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...extra };
}

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { map.delete(key); return undefined; }
  return entry.value;
}

// Сбрасывает кэш целиком — вызывается после любого изменения списка
// пользователей (создание/удаление/смена пароля или роли), чтобы гейт не
// продолжал пускать/не пускать по старым данным ещё минуту.
function clearUsersCache() {
  userCache.clear();
  hasUsersCache.clear();
}

// Есть ли у клиента хотя бы один пользователь — решает, каким путём идёт
// вход (см. api/client-auth.js). fail-open: недоступность Supabase здесь
// трактуется как "пользователей нет" (легаси-путь, единый пароль клиента) —
// это тот же принцип, что и остальная кастомизация: сбой необязательной
// возможности не должен блокировать сам вход.
async function hasClientUsers(clientSlug, { fresh = false } = {}) {
  const cached = fresh ? undefined : getCached(hasUsersCache, clientSlug);
  if (cached !== undefined) return cached;
  const creds = supabaseCreds();
  if (!creds) return false;
  try {
    const url = `${creds.supabaseUrl}/rest/v1/tamga_client_users?client_slug=eq.${encodeURIComponent(clientSlug)}&select=id&limit=1`;
    const res = await fetch(url, { headers: headers(creds.serviceKey) });
    if (!res.ok) return false;
    const rows = await res.json();
    const result = Array.isArray(rows) && rows.length > 0;
    hasUsersCache.set(clientSlug, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (_) {
    return false;
  }
}

// Одна запись пользователя — используется и для входа (проверка пароля),
// и для гейта запросов (resolveClientAuth достаёт роль/ФИО из токена+этой
// записи). fail-CLOSED здесь оправдан: если Supabase недоступен, а у
// клиента точно ЕСТЬ пользователи (hasClientUsers уже это подтвердил),
// молча пропускать вход было бы небезопасно — просто возвращаем null,
// вызывающий код трактует это как "неверный логин или пароль".
async function getClientUser(clientSlug, username, { fresh = false } = {}) {
  if (!clientSlug || !username) return null;
  const cacheKey = `${clientSlug}:${username}`;
  const cached = fresh ? undefined : getCached(userCache, cacheKey);
  if (cached !== undefined) return cached;
  const creds = supabaseCreds();
  if (!creds) return null;
  try {
    const url = `${creds.supabaseUrl}/rest/v1/tamga_client_users?client_slug=eq.${encodeURIComponent(clientSlug)}&username=eq.${encodeURIComponent(username)}&select=${SELECT_COLUMNS}&limit=1`;
    const res = await fetch(url, { headers: headers(creds.serviceKey) });
    if (!res.ok) return null;
    const rows = await res.json();
    const result = Array.isArray(rows) && rows[0] ? rows[0] : null;
    userCache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (_) {
    return null;
  }
}

// Полный список — для страницы управления пользователями (владелец видит
// всех сразу). Не кэшируется — эта страница открывается редко, всегда
// нужен свежий список, а не 60-секундная задержка после чужого изменения.
async function listClientUsers(clientSlug) {
  const creds = supabaseCreds();
  if (!creds) throw new Error('Supabase не настроен');
  const url = `${creds.supabaseUrl}/rest/v1/tamga_client_users?client_slug=eq.${encodeURIComponent(clientSlug)}&select=username,role,translator_name,created_at&order=created_at.asc`;
  const res = await fetch(url, { headers: headers(creds.serviceKey) });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  return data;
}

// Все пользователи ВСЕХ клиентов сразу — для сводного списка в /admin
// (Ethan, 21 сен 2026: "видеть всех пользователей"). Пароли (password_hash)
// намеренно не выбираются — этому эндпоинту они не нужны, а хеш незачем
// лишний раз гонять по сети, даже внутри бэкенда.
async function listAllClientUsers() {
  const creds = supabaseCreds();
  if (!creds) throw new Error('Supabase не настроен');
  const url = `${creds.supabaseUrl}/rest/v1/tamga_client_users?select=client_slug,username,role,translator_name,created_at&order=client_slug.asc,created_at.asc`;
  const res = await fetch(url, { headers: headers(creds.serviceKey) });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  return data;
}

async function countOwners(clientSlug) {
  const creds = supabaseCreds();
  if (!creds) throw new Error('Supabase не настроен');
  const url = `${creds.supabaseUrl}/rest/v1/tamga_client_users?client_slug=eq.${encodeURIComponent(clientSlug)}&role=eq.owner&select=username`;
  const res = await fetch(url, { headers: headers(creds.serviceKey) });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  return Array.isArray(data) ? data.length : 0;
}

async function createClientUser({ clientSlug, username, passwordHash, role, translatorName }) {
  const creds = supabaseCreds();
  if (!creds) throw new Error('Supabase не настроен');
  const url = `${creds.supabaseUrl}/rest/v1/tamga_client_users`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(creds.serviceKey, { Prefer: 'return=representation' }),
    body: JSON.stringify({ client_slug: clientSlug, username, password_hash: passwordHash, role, translator_name: translatorName || null })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  clearUsersCache();
  return data[0];
}

// updates — { passwordHash?, role?, translatorName?, certification? },
// только переданные ключи меняются (частичное обновление). certification —
// личный вариант приписки переводчика (Ethan, 21 сен 2026); {} или null
// означает "своего варианта нет, использовать общий приписки клиента" (см.
// api/client-profile.js).
async function updateClientUser(clientSlug, username, updates) {
  const creds = supabaseCreds();
  if (!creds) throw new Error('Supabase не настроен');
  const body = { updated_at: new Date().toISOString() };
  if ('passwordHash' in updates) body.password_hash = updates.passwordHash;
  if ('role' in updates) body.role = updates.role;
  if ('translatorName' in updates) body.translator_name = updates.translatorName || null;
  if ('certification' in updates) body.certification = (updates.certification && Object.keys(updates.certification).length) ? updates.certification : null;
  const url = `${creds.supabaseUrl}/rest/v1/tamga_client_users?client_slug=eq.${encodeURIComponent(clientSlug)}&username=eq.${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: headers(creds.serviceKey, { Prefer: 'return=representation' }),
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  clearUsersCache();
  return data[0] || null;
}

async function deleteClientUser(clientSlug, username) {
  const creds = supabaseCreds();
  if (!creds) throw new Error('Supabase не настроен');
  const url = `${creds.supabaseUrl}/rest/v1/tamga_client_users?client_slug=eq.${encodeURIComponent(clientSlug)}&username=eq.${encodeURIComponent(username)}`;
  const res = await fetch(url, { method: 'DELETE', headers: headers(creds.serviceKey, { Prefer: 'return=representation' }) });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  clearUsersCache();
  return Array.isArray(data) && data.length > 0;
}

module.exports = {
  hasClientUsers, getClientUser, listClientUsers, listAllClientUsers, countOwners,
  createClientUser, updateClientUser, deleteClientUser, clearUsersCache
};
