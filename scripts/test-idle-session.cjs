const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function browser(storage = new Map(), start = 10000000) {
  let now = start;
  const listeners = {};
  let tick;
  let reloads = 0;
  const context = vm.createContext({
    Date: { now: () => now },
    sessionStorage: {
      getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k),
    },
    document: { visibilityState: 'visible', documentElement: { style: {} } },
    window: {
      addEventListener: (name, fn) => { listeners[name] = fn; },
      setInterval: fn => { tick = fn; },
      location: { reload: () => { reloads++; } },
    },
  });
  const source = fs.readFileSync('public/js/idleSession.js', 'utf8');
  vm.runInContext(source.replace(/export /g, ''), context);
  return {
    session: key => context.createIdleSession(key), storage,
    advance: ms => { now += ms; }, tick: () => tick(),
    event: (name, isTrusted = true) => listeners[name]({ isTrusted }),
    hide: () => { context.document.visibilityState = 'hidden'; },
    reloads: () => reloads,
  };
}

test('credentials expire at one hour and the protected page closes', () => {
  const b = browser(); const s = b.session('client:a'); s.set('token');
  b.advance(3599999); assert.equal(s.get(), 'token');
  b.advance(1); b.tick();
  assert.equal(s.get(), null); assert.equal(b.reloads(), 1);
});

test('real activity extends the session, background reads do not', () => {
  const b = browser(); const s = b.session('client:a'); s.set('token');
  b.advance(3500000); b.event('pointerdown');
  b.advance(3500000); assert.equal(s.get(), 'token');
  b.advance(100000); assert.equal(s.get(), null);
});

test('first click after sleep cannot revive an expired session', () => {
  const b = browser(); const s = b.session('admin'); s.set('key');
  b.advance(7200000); b.event('keydown');
  assert.equal(s.get(), null); assert.equal(b.reloads(), 1);
});

test('reload and navigation retain the original activity deadline', () => {
  const b = browser(); b.session('client:a').set('token');
  const next = browser(b.storage, 13500000); const s = next.session('client:a');
  assert.equal(s.get(), 'token'); next.advance(100000);
  assert.equal(s.get(), null);
});

test('expired or legacy credentials are discarded on page load', () => {
  const b = browser(); b.session('client:a').set('token');
  assert.equal(browser(b.storage, 13600000).session('client:a').get(), null);
  const old = browser(new Map([['admin', 'legacy-key']]));
  assert.equal(old.session('admin').get(), null);
});

test('synthetic events and hidden-page activity do not extend login', () => {
  const b = browser(); const s = b.session('client:a'); s.set('token');
  b.advance(3500000); b.event('pointerdown', false);
  b.hide(); b.event('keydown'); b.advance(100000);
  assert.equal(s.get(), null);
});

test('client activity cannot extend another client login', () => {
  const b = browser(); b.session('client:a').set('a');
  b.session('client:b').set('b');
  const next = browser(b.storage, 13500000); next.session('client:b');
  next.event('pointerdown');
  assert.equal(browser(b.storage, 13600000).session('client:a').get(), null);
  assert.equal(browser(b.storage, 13600000).session('client:b').get(), 'b');
});

test('focus checks expiry without treating focus as activity', () => {
  const b = browser(); const s = b.session('admin'); s.set('key');
  b.advance(3500000); b.event('focus'); b.advance(100000); b.event('pageshow');
  assert.equal(s.get(), null);
});
