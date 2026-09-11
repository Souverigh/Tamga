const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function openSettings(token, status, networkError = false, config = {}, patchStatuses = []) {
  const elements = new Map();
  const requests = [];
  let redirected;
  let cleared = false;
  const context = vm.createContext({
    setTimeout: () => 0, alert: () => {},
    URLSearchParams, DOC_TYPES: [],
    createIdleSession: () => ({ get: () => token, clear: () => { cleared = true; } }),
    window: { location: { search: '?client=acme', replace: url => { redirected = url; } } },
    document: { documentElement: { style: {} }, getElementById: id => {
      if (!elements.has(id)) elements.set(id, { style: { display: id.endsWith('Editor') ? 'none' : '' }, value: '', setAttribute(name, value) { this[name] = value; }, addEventListener(event, handler) { this[event] = handler; }, focus() {} });
      return elements.get(id);
    } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (networkError) throw new Error('offline');
      const responseStatus = options?.method === 'PATCH' && patchStatuses.length ? patchStatuses.shift() : status;
      return { ok: responseStatus === 200, status: responseStatus, json: async () => ({ displayName: 'Acme', ...config }) };
    },
  });
  const source = fs.readFileSync('public/settings/settings.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
  await vm.runInContext(source, context);
  return { elements, requests, get redirected() { return redirected; }, get cleared() { return cleared; } };
}

test('one save includes an open rule draft, even after switching tabs', async () => {
  const b = await openSettings('token', 200);
  b.elements.get('businessRuleEditor').style.display = 'block';
  b.elements.get('ruleType').value = 'date_order';
  b.elements.get('ruleEarlierField').value = 'Дата начала';
  b.elements.get('ruleLaterField').value = 'Дата окончания';
  b.elements.get('ruleLevel').value = 'error';
  b.elements.get('tab-appearance').click();
  await b.elements.get('saveAllBtn').click();
  const payload = JSON.parse(b.requests[1].options.body);
  assert.equal(payload.business_rules.length, 1);
  assert.equal(payload.business_rules[0].earlierField, 'Дата начала');
  assert.equal(b.elements.get('businessRuleEditor').style.display, 'none');
});

test('retry after a failed save retains the draft without duplicating the rule', async () => {
  const b = await openSettings('token', 200, false, {}, [500, 200]);
  b.elements.get('businessRuleEditor').style.display = 'block';
  b.elements.get('ruleType').value = 'required_field';
  b.elements.get('ruleRequiredField').value = 'ИНН';
  await b.elements.get('saveAllBtn').click();
  assert.equal(b.elements.get('businessRuleEditor').style.display, 'block');
  assert.equal(b.elements.get('saveError').style.display, 'block');
  await b.elements.get('saveAllBtn').click();
  for (const request of b.requests.slice(1)) {
    assert.equal(JSON.parse(request.options.body).business_rules.length, 1);
  }
  assert.equal(b.elements.get('businessRuleEditor').style.display, 'none');
});

test('one save collects both field overrides and custom types', async () => {
  const b = await openSettings('token', 200);
  b.elements.get('fieldOverrideEditor').style.display = 'block';
  b.elements.get('overrideTypeSelect').value = 'Справка';
  b.elements.get('overrideFieldsInput').value = 'ФИО, Номер';
  b.elements.get('customTypeEditor').style.display = 'block';
  b.elements.get('newTypeName').value = 'Заявление';
  b.elements.get('newTypeFields').value = 'ФИО';
  await b.elements.get('saveAllBtn').click();
  const payload = JSON.parse(b.requests[1].options.body);
  assert.deepEqual(payload.field_overrides['Справка'], ['ФИО', 'Номер']);
  assert.deepEqual(payload.custom_doc_types['Заявление'].fields, ['ФИО']);
});

test('invalid open draft prevents sending a partial save', async () => {
  const b = await openSettings('token', 200);
  b.elements.get('customTypeEditor').style.display = 'block';
  await b.elements.get('saveAllBtn').click();
  assert.equal(b.requests.length, 1);
  assert.equal(b.elements.get('customTypeEditor').style.display, 'block');
});

test('settings tabs retain draft inputs and separate the password action', async () => {
  const b = await openSettings('token', 200);
  assert.ok(b.elements.has('tab-rules'));
  b.elements.get('tab-rules').click();
  assert.equal(b.elements.get('panel-rules').hidden, false);
  assert.equal(b.elements.get('panel-recognition').hidden, true);
  b.elements.get('ruleEarlierField').value = 'Черновик';
  b.elements.get('tab-password').click();
  assert.equal(b.elements.get('settingsSaveBar').hidden, true);
  b.elements.get('tab-rules').click();
  assert.equal(b.elements.get('ruleEarlierField').value, 'Черновик');
  assert.equal(b.elements.get('settingsSaveBar').hidden, false);
});

test('full-text switch loads and saves the disabled client preference', async () => {
  const b = await openSettings('token', 200, false, { includeText: false });
  assert.equal(b.elements.get('fIncludeText')?.checked, false);
  await b.elements.get('saveAllBtn').click();
  assert.equal(JSON.parse(b.requests[1].options.body).include_text, false);
});

test('full-text extraction defaults to enabled for existing clients', async () => {
  const b = await openSettings('token', 200);
  assert.equal(b.elements.get('fIncludeText')?.checked, true);
});

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
