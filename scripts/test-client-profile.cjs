// Регрессия: api/client-profile.js — личный профиль (ФИО + свой вариант
// приписки) для ЛЮБОЙ роли (owner/translator), но ТОЛЬКО для своей же
// учётной записи (Ethan, 21 сен 2026: "чтобы переводчики сами могли
// изменить, иметь свой вариант приписки"). Проверяет:
//   1) без валидного токена — 401;
//   2) легаси-клиент без персональных пользователей — 400 (профиля нет);
//   3) реальный пользователь получает/сохраняет своё ФИО и certification;
//   4) тело запроса не может подменить чужую запись — сервер всегда
//      обновляет auth.username из токена, а не то, что прислали в body.
//
// Та же имитация Supabase (in-memory + мини-парсер PostgREST), что в
// scripts/test-client-users.cjs.

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
    if (method === 'GET') return { ok: true, json: async () => rows.filter(r => matches(r, u.searchParams)) };
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
    throw new Error('unexpected method ' + method);
  }
  return { fetchImpl, get rows() { return rows; } };
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
}

const root = path.resolve(__dirname, '..');

// getClientConfig подменяется фиксированным конфигом теста (passwordHash —
// легаси-путь без пользователей); clientAuth/clientUsers — настоящие,
// против fakeSupabase (та же связка, что "api/client-users" в
// test-client-users.cjs).
function loadApi({ passwordHash = null } = {}) {
  // Оба модуля должны быть загружены ЗАНОВО в одном и том же порядке, что
  // и в реальном приложении: lib/clientAuth.js на своём верхнем уровне
  // делает `require('./clientUsers')` и держит ссылки на ЕГО функции — если
  // почистить кэш только clientUsers.js, а clientAuth.js останется закэширован
  // с прошлого теста, он продолжит смотреть на СТАРЫЙ (уже неактуальный)
  // экземпляр clientUsers.js с чужими in-memory данными предыдущего теста.
  delete require.cache[require.resolve(path.join(root, 'lib/clientUsers.js'))];
  delete require.cache[require.resolve(path.join(root, 'lib/clientAuth.js'))];
  const context = vm.createContext({
    module: { exports: {} }, console,
    require: name => {
      if (name === '../lib/customFieldsLookup') return { getClientConfig: async () => ({ passwordHash }) };
      const resolved = name.startsWith('../lib/') ? path.join(root, name.slice(3)) : name;
      return require(resolved);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'api/client-profile.js'), 'utf8'), context);
  return context.module.exports;
}

function invoke(api, method, { query, headers, body } = {}) {
  const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
  return Promise.resolve(api({ method, query: query || {}, headers: headers || {}, body }, res)).then(() => res);
}

function withFakeSupabase({ rows, passwordHash } = {}, fn) {
  return withEnv({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake', TAMGA_CLIENT_AUTH_SECRET: 'test-secret' }, async () => {
    const fake = fakeSupabase(rows);
    const realFetch = global.fetch;
    global.fetch = fake.fetchImpl;
    try {
      const api = loadApi({ passwordHash });
      const auth = require(path.join(root, 'lib/clientAuth.js'));
      await fn({ api, fake, auth });
    } finally {
      global.fetch = realFetch;
    }
  });
}

test('api/client-profile: no/invalid token → 401 (when the client actually has a gate)', async () => {
  // Без пароля и без пользователей у клиента гейта нет вообще (см.
  // lib/clientAuth.js:checkClientGate) — тест должен быть про клиента,
  // у которого гейт реально есть, иначе 400 "нет профиля" тоже корректен,
  // просто по другой причине.
  await withFakeSupabase({ passwordHash: 'legacy-hash' }, async ({ api }) => {
    const res = await invoke(api, 'GET', { query: { slug: 'acme' } });
    assert.equal(res.code, 401);
  });
});

test('api/client-profile: legacy client without a personal account → 400 (nothing to self-serve)', async () => {
  await withFakeSupabase({ passwordHash: 'legacy-hash' }, async ({ api, auth }) => {
    const token = auth.signToken('acme', 'legacy-hash'); // без username — легаси-токен
    const res = await invoke(api, 'GET', { query: { slug: 'acme' }, headers: { 'x-client-token': token } });
    assert.equal(res.code, 400);
  });
});

test('api/client-profile: a real translator can read and save their own name + certification', async () => {
  await withFakeSupabase({}, async ({ api, fake, auth }) => {
    const passwordHash = auth.hashPassword('trans-pw');
    await require(path.join(root, 'lib/clientUsers.js')).createClientUser({ clientSlug: 'acme', username: 'aigul', passwordHash, role: 'translator' });
    const token = auth.signToken('acme', passwordHash, 'aigul');
    const headers = { 'x-client-token': token };

    // JSON round-trip: тела ответов собраны внутри vm-загруженного модуля —
    // объекты принадлежат другому realm'у, deepEqual падал бы на одной
    // только несовпадающей идентичности прототипа (см. test-translation.cjs
    // с тем же комментарием про round-trip для той же причины).
    const roundTrip = v => JSON.parse(JSON.stringify(v));

    const empty = await invoke(api, 'GET', { query: { slug: 'acme' }, headers });
    assert.equal(empty.code, 200);
    assert.deepEqual(roundTrip(empty.body.certification), {});

    const patch = await invoke(api, 'PATCH', {
      query: { slug: 'acme' }, headers,
      body: { translatorName: 'Иванова Айгуль', certification: { companyName: 'Моё бюро', phone: '+996 700 000000' } }
    });
    assert.equal(patch.code, 200);
    assert.equal(patch.body.translatorName, 'Иванова Айгуль');
    assert.deepEqual(roundTrip(patch.body.certification), { companyName: 'Моё бюро', phone: '+996 700 000000' });

    const stored = fake.rows.find(r => r.username === 'aigul');
    assert.deepEqual(roundTrip(stored.certification), { companyName: 'Моё бюро', phone: '+996 700 000000' });

    // Пустой certification в PATCH — это НЕ "ничего не менять", а явная
    // очистка (см. lib/clientUsers.js: {} схлопывается в null).
    const cleared = await invoke(api, 'PATCH', { query: { slug: 'acme' }, headers, body: { certification: {} } });
    assert.equal(cleared.code, 200);
    assert.deepEqual(roundTrip(cleared.body.certification), {});
    assert.equal(fake.rows.find(r => r.username === 'aigul').certification, null);
  });
});

test('api/client-profile: the request body cannot target another user — the server always updates the TOKEN\'s own username', async () => {
  await withFakeSupabase({}, async ({ api, auth }) => {
    const clientUsers = require(path.join(root, 'lib/clientUsers.js'));
    const hashA = auth.hashPassword('pw-a'), hashB = auth.hashPassword('pw-b');
    await clientUsers.createClientUser({ clientSlug: 'acme', username: 'user-a', passwordHash: hashA, role: 'translator' });
    await clientUsers.createClientUser({ clientSlug: 'acme', username: 'user-b', passwordHash: hashB, role: 'translator' });
    const tokenA = auth.signToken('acme', hashA, 'user-a');

    // Токен принадлежит user-a; тело запроса пытается протащить username
    // чужого пользователя — эндпоинт его читает откуда угодно, только не
    // отсюда (нет самого поля username в схеме тела вообще), так что
    // подмена невозможна структурно, а не только по логике.
    const res = await invoke(api, 'PATCH', {
      query: { slug: 'acme' }, headers: { 'x-client-token': tokenA },
      body: { username: 'user-b', certification: { companyName: 'Захват чужого профиля' } }
    });
    assert.equal(res.code, 200);
    assert.equal(res.body.username, 'user-a');

    const userA = await clientUsers.getClientUser('acme', 'user-a', { fresh: true });
    const userB = await clientUsers.getClientUser('acme', 'user-b', { fresh: true });
    assert.deepEqual(userA.certification, { companyName: 'Захват чужого профиля' });
    // user-b никогда не получал collections/updateClientUser — поле просто
    // не было выставлено при создании (см. lib/clientUsers.js:createClientUser),
    // а не явно обнулено, отсюда undefined, а не null.
    assert.equal(userB.certification, undefined, 'чужая запись не должна была измениться');
  });
});
