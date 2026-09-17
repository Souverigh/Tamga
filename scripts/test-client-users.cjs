// Регрессия: пользователи внутри клиента (Ethan, 17 сен 2026 — "внутри
// клиента можно создать пользователей с разными ролями, свой логин и
// пароль"). Покрывает:
//   1) lib/clientUsers.js — CRUD против имитации Supabase REST (in-memory).
//   2) lib/clientAuth.js — легаси-путь (без пользователей) не меняется;
//      с пользователями токен привязан к КОНКРЕТНОМУ человеку — смена
//      пароля/удаление аннулирует именно его токен, не чужие.
//   3) api/client-auth.js — вход: без пользователей просто password, с
//      пользователями требует username (иначе явный код USERNAME_REQUIRED).
//   4) api/client-users.js — управление доступно только роли 'owner',
//      нельзя понизить/удалить последнего владельца.
//
// Имитация Supabase — простой in-memory массив строк + мини-парсер PostgREST
// query string (eq.-фильтры, select, order, limit). Реальных сетевых
// вызовов нет.

const { test } = require('node:test');
const assert = require('node:assert/strict');

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
      const matched = rows.filter(r => matches(r, u.searchParams));
      return { ok: true, json: async () => matched };
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

function freshModule(id) {
  delete require.cache[require.resolve(id)];
  return require(id);
}

test('lib/clientUsers: CRUD against a fresh table, cache invalidated on writes', async () => {
  await withEnv({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake' }, async () => {
    const fake = fakeSupabase();
    const realFetch = global.fetch;
    global.fetch = fake.fetchImpl;
    try {
      const clientUsers = freshModule('../lib/clientUsers');
      assert.equal(await clientUsers.hasClientUsers('acme'), false);
      const created = await clientUsers.createClientUser({ clientSlug: 'acme', username: 'aigul', passwordHash: 'h1', role: 'owner', translatorName: 'Иванова Айгуль' });
      assert.equal(created.username, 'aigul');
      assert.equal(await clientUsers.hasClientUsers('acme'), true);
      assert.equal(await clientUsers.hasClientUsers('other-client'), false);
      const fetched = await clientUsers.getClientUser('acme', 'aigul');
      assert.equal(fetched.role, 'owner');
      assert.equal(await clientUsers.countOwners('acme'), 1);
      await clientUsers.createClientUser({ clientSlug: 'acme', username: 'nurlan', passwordHash: 'h2', role: 'translator', translatorName: 'Нурлан' });
      const list = await clientUsers.listClientUsers('acme');
      assert.equal(list.length, 2);
      await clientUsers.updateClientUser('acme', 'nurlan', { role: 'owner' });
      assert.equal(await clientUsers.countOwners('acme'), 2);
      const deleted = await clientUsers.deleteClientUser('acme', 'nurlan');
      assert.equal(deleted, true);
      assert.equal((await clientUsers.listClientUsers('acme')).length, 1);
    } finally {
      global.fetch = realFetch;
    }
  });
});

test('lib/clientAuth: legacy path (no sub-users) is completely unchanged — single client password, role owner', async () => {
  await withEnv({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake', TAMGA_CLIENT_AUTH_SECRET: 'test-secret' }, async () => {
    const fake = fakeSupabase(); // пустая таблица — у клиента нет пользователей
    const realFetch = global.fetch;
    global.fetch = fake.fetchImpl;
    try {
      const auth = freshModule('../lib/clientAuth');
      const passwordHash = auth.hashPassword('client-password');
      const token = auth.signToken('acme', passwordHash); // username не передан — легаси-токен
      const gate = await auth.checkClientGate({ clientSlug: 'acme', passwordHash, token });
      assert.equal(gate.ok, true);
      assert.equal(gate.role, 'owner');
      assert.equal(gate.username, '');
      // Токен другого клиента/с другим паролем не проходит — как и раньше.
      const wrongPassword = auth.hashPassword('other-password');
      assert.equal((await auth.checkClientGate({ clientSlug: 'acme', passwordHash: wrongPassword, token })).ok, false);
    } finally {
      global.fetch = realFetch;
    }
  });
});

test('lib/clientAuth: per-user tokens — changing ONE user\'s password only invalidates THEIR token, and role is always read fresh from the DB', async () => {
  await withEnv({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake', TAMGA_CLIENT_AUTH_SECRET: 'test-secret' }, async () => {
    const fake = fakeSupabase();
    const realFetch = global.fetch;
    global.fetch = fake.fetchImpl;
    try {
      const clientUsers = freshModule('../lib/clientUsers');
      const auth = freshModule('../lib/clientAuth');
      const ownerHash = auth.hashPassword('owner-pw');
      const translatorHash = auth.hashPassword('translator-pw');
      await clientUsers.createClientUser({ clientSlug: 'acme', username: 'boss', passwordHash: ownerHash, role: 'owner' });
      await clientUsers.createClientUser({ clientSlug: 'acme', username: 'trans', passwordHash: translatorHash, role: 'translator', translatorName: 'Нурлан Т.' });

      const ownerToken = auth.signToken('acme', ownerHash, 'boss');
      const translatorToken = auth.signToken('acme', translatorHash, 'trans');

      const ownerGate = await auth.checkClientGate({ clientSlug: 'acme', passwordHash: null, token: ownerToken });
      assert.equal(ownerGate.ok, true); assert.equal(ownerGate.role, 'owner'); assert.equal(ownerGate.username, 'boss');

      const translatorGate = await auth.checkClientGate({ clientSlug: 'acme', passwordHash: null, token: translatorToken });
      assert.equal(translatorGate.ok, true); assert.equal(translatorGate.role, 'translator');
      assert.equal(translatorGate.translatorName, 'Нурлан Т.');

      // Меняем пароль ТОЛЬКО переводчика — его токен перестаёт работать,
      // токен владельца остаётся валидным.
      await clientUsers.updateClientUser('acme', 'trans', { passwordHash: auth.hashPassword('new-translator-pw') });
      assert.equal((await auth.checkClientGate({ clientSlug: 'acme', passwordHash: null, token: translatorToken })).ok, false);
      assert.equal((await auth.checkClientGate({ clientSlug: 'acme', passwordHash: null, token: ownerToken })).ok, true);

      // Роль переводчика меняют на owner в БД — уже выданный токен сразу
      // отражает новую роль (роль не "запекается" в токен, см. resolveIdentity).
      const promoPasswordHash = auth.hashPassword('promo-pw');
      const secondTranslatorToken = auth.signToken('acme', promoPasswordHash, 'trans2');
      await clientUsers.createClientUser({ clientSlug: 'acme', username: 'trans2', passwordHash: promoPasswordHash, role: 'translator' });
      let gate2 = await auth.checkClientGate({ clientSlug: 'acme', passwordHash: null, token: secondTranslatorToken });
      assert.equal(gate2.role, 'translator');
      await clientUsers.updateClientUser('acme', 'trans2', { role: 'owner' });
      gate2 = await auth.checkClientGate({ clientSlug: 'acme', passwordHash: null, token: secondTranslatorToken });
      assert.equal(gate2.role, 'owner', 'уже выданный токен должен сразу видеть новую роль из БД');
    } finally {
      global.fetch = realFetch;
    }
  });
});

test('api/client-auth: legacy login (no sub-users) vs multi-user login (needs username, else USERNAME_REQUIRED)', async () => {
  await withEnv({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake', TAMGA_CLIENT_AUTH_SECRET: 'test-secret' }, async () => {
    const fake = fakeSupabase();
    const realFetch = global.fetch;
    global.fetch = fake.fetchImpl;
    try {
      // Стабим только то, что не связано с БД пользователей (rate limit,
      // getClientConfig легаси-пароля) — сама multi-user логика идёт через
      // настоящий lib/clientUsers.js против fakeSupabase.
      const path = require('node:path');
      const vm = require('node:vm');
      const fs = require('node:fs');
      const root = path.resolve(__dirname, '..');
      function loadApi(stubs) {
        const context = vm.createContext({
          module: { exports: {} }, console,
          require: name => stubs[name] || require(name)
        });
        vm.runInContext(fs.readFileSync(path.join(root, 'api/client-auth.js'), 'utf8'), context);
        return context.module.exports;
      }
      const stubs = {
        '../lib/authRateLimit': { checkClientAuthRateLimit: async () => ({ allowed: true }), recordClientAuthFailure: async () => {} },
        '../lib/anonymousUsage': { extractClientIp: () => 'test-ip' }
      };
      const api = loadApi(stubs);
      const invoke = async body => {
        const res = { status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
        await api({ method: 'POST', body }, res);
        return res;
      };

      // Легаси-путь: клиент без пользователей, обычный пароль клиента.
      const clientUsers = freshModule('../lib/clientUsers');
      const auth = freshModule('../lib/clientAuth');
      const clientPasswordHash = auth.hashPassword('client-pw');
      // Подменяем только getClientConfig (легаси-путь читает пароль клиента
      // из customFieldsLookup, а не из tamga_client_users).
      delete require.cache[require.resolve('../lib/customFieldsLookup')];
      const stubsWithConfig = { ...stubs, '../lib/customFieldsLookup': { getClientConfig: async () => ({ passwordHash: clientPasswordHash }) } };
      const legacyApi = loadApi(stubsWithConfig);
      const legacyInvoke = async body => { const res = { status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } }; await legacyApi({ method: 'POST', body }, res); return res; };
      const legacyRes = await legacyInvoke({ clientSlug: 'acme', password: 'client-pw' });
      assert.equal(legacyRes.code, 200);
      assert.ok(legacyRes.body.token);
      assert.equal(legacyRes.body.role, 'owner');

      // Теперь у клиента появляется пользователь — легаси-пароль больше не
      // должен подходить (используется тот же loadApi, тот же fetch-мок).
      await clientUsers.createClientUser({ clientSlug: 'acme', username: 'boss', passwordHash: auth.hashPassword('boss-pw'), role: 'owner' });
      const withoutUsername = await legacyInvoke({ clientSlug: 'acme', password: 'boss-pw' });
      assert.equal(withoutUsername.code, 400);
      assert.equal(withoutUsername.body.code, 'USERNAME_REQUIRED');

      const wrongPassword = await legacyInvoke({ clientSlug: 'acme', username: 'boss', password: 'wrong' });
      assert.equal(wrongPassword.code, 401);

      const rightLogin = await legacyInvoke({ clientSlug: 'acme', username: 'boss', password: 'boss-pw' });
      assert.equal(rightLogin.code, 200);
      assert.ok(rightLogin.body.token);
      assert.equal(rightLogin.body.role, 'owner');
    } finally {
      global.fetch = realFetch;
    }
  });
});

test('api/client-users: only role=owner can manage users; cannot demote/delete the last owner', async () => {
  await withEnv({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake', TAMGA_CLIENT_AUTH_SECRET: 'test-secret' }, async () => {
    const fake = fakeSupabase();
    const realFetch = global.fetch;
    global.fetch = fake.fetchImpl;
    try {
      const clientUsers = freshModule('../lib/clientUsers');
      const auth = freshModule('../lib/clientAuth');
      const path = require('node:path');
      const vm = require('node:vm');
      const fs = require('node:fs');
      const root = path.resolve(__dirname, '..');
      let currentRole = 'owner';
      const context = vm.createContext({
        module: { exports: {} }, console,
        require: name => {
          if (name.includes('customFieldsLookup')) return { getClientConfig: async () => ({ passwordHash: null }) };
          if (name.includes('clientAuth') && !name.includes('/')) return require(name); // не должно сработать, оставлено для явности
          return require('../' + name.replace(/^\.\.\//, ''));
        }
      });
      // requireClientSettingsAuth подменяем напрямую под текущую роль теста —
      // сам гейт (кто есть кто) уже покрыт тестами lib/clientAuth выше;
      // здесь проверяем именно поведение api/client-users.js при разных ролях.
      context.require = name => {
        if (name.includes('customFieldsLookup')) return { getClientConfig: async () => ({ passwordHash: null }) };
        if (name.includes('clientAuth')) return { ...auth, requireClientSettingsAuth: async () => ({ ok: true, role: currentRole, username: 'whoever' }) };
        return require('../' + name.replace(/^\.\.\//, ''));
      };
      vm.runInContext(fs.readFileSync(path.join(root, 'api/client-users.js'), 'utf8'), context);
      const api = context.module.exports;
      const invoke = async (method, body) => {
        const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
        await api({ method, query: { slug: 'acme' }, headers: {}, body }, res);
        return res;
      };

      currentRole = 'translator';
      const blocked = await invoke('POST', { username: 'x', password: 'password1', role: 'translator' });
      assert.equal(blocked.code, 403);

      currentRole = 'owner';
      const created = await invoke('POST', { username: 'owner1', password: 'password1', role: 'owner' });
      assert.equal(created.code, 201);
      const created2 = await invoke('POST', { username: 'trans1', password: 'password1', role: 'translator', translatorName: 'Айгуль' });
      assert.equal(created2.code, 201);

      const list = await invoke('GET');
      assert.equal(list.body.users.length, 2);

      // Единственный владелец — 'owner1' и 'boss' ещё нет, значит owner1 —
      // единственный owner. Попытка понизить его должна быть отклонена.
      const demote = await invoke('PATCH', { username: 'owner1', role: 'translator' });
      assert.equal(demote.code, 400);

      // Второй владелец есть — теперь понизить/удалить первого можно.
      await invoke('POST', { username: 'owner2', password: 'password1', role: 'owner' });
      const demoteOk = await invoke('PATCH', { username: 'owner1', role: 'translator' });
      assert.equal(demoteOk.code, 200);

      // Удаление последнего владельца запрещено.
      const deleteLastOwner = await invoke('DELETE', { username: 'owner2' });
      assert.equal(deleteLastOwner.code, 400);
    } finally {
      global.fetch = realFetch;
    }
  });
});
