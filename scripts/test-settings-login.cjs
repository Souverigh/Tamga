const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function openSettings(token, status, networkError = false) {
  const elements = new Map();
  const requests = [];
  let redirected;
  let cleared = false;
  const context = vm.createContext({
    URLSearchParams, DOC_TYPES: [],
    createIdleSession: () => ({ get: () => token, clear: () => { cleared = true; } }),
    window: { location: { search: '?client=acme', replace: url => { redirected = url; } } },
    document: { documentElement: { style: {} }, getElementById: id => {
      if (!elements.has(id)) elements.set(id, { style: {}, value: '', addEventListener(event, handler) { this[event] = handler; }, focus() {} });
      return elements.get(id);
    } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (networkError) throw new Error('offline');
      return { ok: status === 200, status, json: async () => ({ displayName: 'Acme' }) };
    },
  });
  const source = fs.readFileSync('public/settings/settings.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
  await vm.runInContext(source, context);
  return { elements, requests, get redirected() { return redirected; }, get cleared() { return cleared; } };
}

test('settings logout clears the session and closes the settings page', async () => {
  const b = await openSettings('existing-token', 200);
  assert.equal(b.elements.get('logoutBtn').style.display, 'inline-flex');
  b.elements.get('logoutBtn').click();
  assert.equal(b.cleared, true);
  assert.equal(b.redirected, '/?client=acme');
  assert.equal(b.elements.get('settingsMain').style.display, 'none');
});

test('settings reuse client login without requesting a password', async () => {
  const b = await openSettings('existing-token', 200);
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].options.headers['x-client-token'], 'existing-token');
  assert.equal(b.elements.get('settingsMain').style.display, 'block');
  assert.equal(b.elements.get('fDisplayName').value, 'Acme');
  assert.equal(b.redirected, undefined);
});

test('missing login goes to the client entry page', async () => {
  const b = await openSettings(null, 401);
  assert.equal(b.redirected, '/?client=acme');
});

test('server-rejected login is cleared and returns to client entry', async () => {
  const b = await openSettings('expired-token', 401);
  assert.equal(b.redirected, '/?client=acme');
  assert.equal(b.cleared, true);
});

test('client without a password gets an explanation rather than a login loop', async () => {
  const b = await openSettings(null, 403);
  assert.equal(b.elements.get('noPassword').style.display, 'block');
  assert.equal(b.redirected, undefined);
});

test('server and network errors do not discard valid login', async () => {
  for (const offline of [false, true]) {
    const b = await openSettings('valid-token', 500, offline);
    assert.equal(b.cleared, false);
    assert.equal(b.redirected, undefined);
    assert.equal(b.elements.get('loadError').style.display, 'block');
  }
});
