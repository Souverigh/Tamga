// Browser idle logout; the server independently validates credentials as before.
// Keep activity next to each credential so navigation cannot reset its deadline.
const IDLE_MS = 60 * 60 * 1000;
const sessions = new Map();

export function createIdleSession(key) {
  if (sessions.has(key)) return sessions.get(key);
  const activityKey = key + ':lastActivity';
  let expired = false;

  function clear() {
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(activityKey);
  }

  function get(notify = true) {
    const credential = sessionStorage.getItem(key);
    if (!credential) return null;
    const last = Number(sessionStorage.getItem(activityKey));
    const now = Date.now();
    if (!Number.isFinite(last) || last <= 0 || last > now || now - last >= IDLE_MS) {
      clear();
      if (notify && !expired) {
        expired = true;
        // Hide sensitive content immediately, including when returning from sleep.
        document.documentElement.style.visibility = 'hidden';
        window.location.reload();
      }
      return null;
    }
    return credential;
  }

  function set(credential) {
    expired = false;
    sessionStorage.setItem(key, credential);
    sessionStorage.setItem(activityKey, String(Date.now()));
  }

  // Old sessions without an activity timestamp require a fresh login.
  get(false);
  const session = { get, set, clear };
  sessions.set(key, session);
  const check = () => { get(); };
  const activity = event => {
    // Check BEFORE renewing: the first click after an hour must not revive login.
    if (get() && event.isTrusted && document.visibilityState === 'visible') {
      sessionStorage.setItem(activityKey, String(Date.now()));
    }
  };
  for (const name of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']) {
    window.addEventListener(name, activity, { capture: true, passive: true });
  }
  for (const name of ['focus', 'pageshow', 'visibilitychange']) {
    window.addEventListener(name, check, true);
  }
  window.setInterval(check, 1000);
  return session;
}
