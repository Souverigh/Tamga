// Регрессия: обзор/управление пользователями клиентов из /admin (Ethan,
// 21 сен 2026 — "видеть всех пользователей и их пароли" — пароли необратимо
// хешированы, поэтому вместо просмотра админка даёт сводный список логинов/
// ролей всех клиентов сразу плюс создание/сброс пароля/удаление, см.
// api/admin/client-users.js). Проверяет:
//   1) без x-admin-secret — 401/500 (не пускает).
//   2) GET без ?slug= агрегирует пользователей СРАЗУ НЕСКОЛЬКИХ клиентов.
//   3) POST создаёт пользователя с паролем-хешем (не plaintext).
//   4) PATCH сбрасывает пароль/роль без старого пароля; нельзя понизить
//      последнего владельца конкретного клиента.
//   5) DELETE нельзя удалить последнего владельца.
//
// Имитация Supabase — тот же приём, что в test-client-users.cjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

function fakeSupabase(initialRows = []) {
  let rows = initialRows.map(r => ({ ...r }));
  let nextId = 1;
  function matches(row, searchParams) {
    for (const [key, value] of searchParams.entries()) {
      if (['select', 'order', 'limit'].includes(key)) continue;
      if (!value.startsWith('eq.')) continue;
      if (String(row[key]) !== value.slice(3)) return false;
    }
    return true;
  }
  async function fetchImpl(url, options = {}) {
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    if (table !== 'tamga_client_users') throw new Error('unexpected table ' + table);
    const method = options.method || 'GET';
    if (method === 'GET') {
      return { ok: true, json: async () => rows.filter(r => matches(r, u.searchParams)) };
    }
    if (method === 'POST') {
      const body = JSON.parse(options.body);
      const row = { id: String(nextId++), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body };
      rows.push(row);
      return { ok: true, json: async () => [row] };
    }
    if (method === 'PATCH') {
      const body = JSON.parse(options.body);
      const matched = rows.filter(r => matches(r, u.searchParams));
      matched.forEach(r => Object.assign(r, body));
      return { ok: true, json: async () => matched };
    }
    if (method === 'DELETE') {
      const matched = rows.filter(r => matches(r, u.searchParams));
      rows = rows.filter(r => !matches(r, u.searchParams));
      return { ok: true, json: async () => matched };
    }
    throw new Error('unexpected method ' + method);
  }
  return { fetchImpl, get rows() { return rows; } };
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
}

// checkAdminSecret (rate-limit/секрет) уже покрыт lib/adminAuth — здесь
// подменяем его на простую проверку заголовка, чтобы тест бил именно по
// новой логике (агрегация/CRUD), а не переоткрывал adminAuth.
// fetch остаётся подменённым (global.fetch) на всё время жизни api — не
// только на момент require: lib/clientUsers.js резолвит global.fetch в
// момент КАЖДОГО вызова, а не при загрузке модуля (см. test-client-users.cjs —
// та же причина, почему там подмена fetch держится в try/finally теста).
function loadApi({ adminOk }) {
  const root = path.resolve(__dirname, '..');
  // lib/clientUsers.js кэширует hasClientUsers/getClientUser на 60с в
  // module-level Map — без сброса кэша между тестами результаты одного теста
  // протекали бы в следующий (общий require.cache в рамках процесса).
  delete require.cache[require.resolve(path.join(root, 'lib/clientUsers.js'))];
  const context = vm.createContext({
    module: { exports: {} }, console,
    require: name => {
      if (name === '../../lib/adminAuth') return { checkAdminSecret: async () => (adminOk ? { ok: true } : { ok: false, status: 401, message: 'нет доступа' }) };
      const resolved = name.startsWith('../../') ? path.join(root, name.slice(6)) : name;
      return require(resolved);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'api/admin/client-users.js'), 'utf8'), context);
  return context.module.exports;
}

function invoke(api, method, { query, body } = {}) {
  const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
  return Promise.resolve(api({ method, query: query || {}, headers: {}, body }, res)).then(() => res);
}

// global.fetch подменяется на ВСЁ время выполнения fn — не только на момент
// loadApi (см. комментарий у loadApi выше).
function withFakeSupabase({ adminOk = true, rows } = {}, fn) {
  return withEnv({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake' }, async () => {
    const fake = fakeSupabase(rows);
    const realFetch = global.fetch;
    global.fetch = fake.fetchImpl;
    try {
      const api = loadApi({ adminOk });
      await fn({ api, fake });
    } finally {
      global.fetch = realFetch;
    }
  });
}

test('api/admin/client-users: x-admin-secret gate blocks without valid secret', async () => {
  await withFakeSupabase({ adminOk: false }, async ({ api }) => {
    const res = await invoke(api, 'GET');
    assert.equal(res.code, 401);
  });
});

test('api/admin/client-users: GET without slug aggregates users across MULTIPLE clients', async () => {
  await withFakeSupabase({
    rows: [
      { client_slug: 'acme', username: 'boss', role: 'owner', password_hash: 'h1', created_at: '2026-09-01T00:00:00Z' },
      { client_slug: 'globex', username: 'chief', role: 'owner', password_hash: 'h2', created_at: '2026-09-02T00:00:00Z' }
    ]
  }, async ({ api }) => {
    const res = await invoke(api, 'GET');
    assert.equal(res.code, 200);
    const slugs = res.body.users.map(u => u.clientSlug).sort();
    assert.deepEqual(slugs, ['acme', 'globex']);
    // Пароль/хеш никогда не должен попадать в ответ — только логин/роль/имя.
    assert.equal(res.body.users.every(u => !('password_hash' in u) && !('passwordHash' in u)), true);
  });
});

test('api/admin/client-users: POST creates a user with a hashed (not plaintext) password', async () => {
  await withFakeSupabase({}, async ({ api, fake }) => {
    const res = await invoke(api, 'POST', { body: { clientSlug: 'acme', username: 'boss', password: 'owner-password', role: 'owner' } });
    assert.equal(res.code, 201);
    assert.equal(res.body.username, 'boss');
    const stored = fake.rows.find(r => r.username === 'boss');
    assert.ok(stored.password_hash);
    assert.notEqual(stored.password_hash, 'owner-password');
  });
});

test('api/admin/client-users: PATCH resets a password without the old one; cannot demote the last owner of a client', async () => {
  await withFakeSupabase({}, async ({ api, fake }) => {
    await invoke(api, 'POST', { body: { clientSlug: 'acme', username: 'boss', password: 'first-password', role: 'owner' } });

    const oldHash = fake.rows.find(r => r.username === 'boss').password_hash;
    const resetRes = await invoke(api, 'PATCH', { body: { clientSlug: 'acme', username: 'boss', password: 'brand-new-password' } });
    assert.equal(resetRes.code, 200);
    assert.notEqual(fake.rows.find(r => r.username === 'boss').password_hash, oldHash);

    const demoteRes = await invoke(api, 'PATCH', { body: { clientSlug: 'acme', username: 'boss', role: 'translator' } });
    assert.equal(demoteRes.code, 400);

    // Второй владелец другого клиента не должен мешать/помогать этой проверке.
    await invoke(api, 'POST', { body: { clientSlug: 'globex', username: 'chief', password: 'other-password', role: 'owner' } });
    const demoteStill = await invoke(api, 'PATCH', { body: { clientSlug: 'acme', username: 'boss', role: 'translator' } });
    assert.equal(demoteStill.code, 400);
  });
});

test('api/admin/client-users: DELETE cannot remove the last owner of a client', async () => {
  await withFakeSupabase({}, async ({ api }) => {
    await invoke(api, 'POST', { body: { clientSlug: 'acme', username: 'boss', password: 'first-password', role: 'owner' } });
    const blocked = await invoke(api, 'DELETE', { body: { clientSlug: 'acme', username: 'boss' } });
    assert.equal(blocked.code, 400);

    await invoke(api, 'POST', { body: { clientSlug: 'acme', username: 'second-owner', password: 'second-password', role: 'owner' } });
    const allowed = await invoke(api, 'DELETE', { body: { clientSlug: 'acme', username: 'boss' } });
    assert.equal(allowed.code, 200);
  });
});
