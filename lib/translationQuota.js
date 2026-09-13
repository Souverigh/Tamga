const { createHash } = require('crypto');

// Separate namespaced counters using the existing atomic, service-only RPC.
// Attempts are charged before upstream work; OCR page balances are untouched.
async function consumeTranslationQuota({identity,authenticated}) {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const unavailable = () => Object.assign(new Error('Учёт переводов временно недоступен.'),{status:503});
  if (!url || !secret) throw unavailable();
  const limit = (key,fallback) => {
    const n = Number(process.env[key]);
    return Number.isSafeInteger(n) && n > 0 ? n : fallback;
  };
  const kind = authenticated ? 'CLIENT' : 'FREE';
  const windows = [
    ['day',86400,limit(`TAMGA_TRANSLATION_${kind}_DAILY_REQUESTS`,authenticated?50:5)],
    ['month',2592000,limit(`TAMGA_TRANSLATION_${kind}_MONTHLY_REQUESTS`,authenticated?1000:100)]
  ];
  const owner = createHash('sha256').update(identity).digest('hex');
  for (const [name,seconds,max] of windows) {
    let row;
    try {
      const r = await fetch(`${url}/rest/v1/rpc/consume_feedback_attempt`,{method:'POST',signal:AbortSignal.timeout(5000),headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({p_key:`translation:${name}:${owner}`,p_window_seconds:seconds,p_max_attempts:max})});
      if (!r.ok) throw unavailable();
      const data = await r.json(); row = Array.isArray(data)?data[0]:data;
      if (typeof row?.allowed !== 'boolean') throw unavailable();
    } catch (_) { throw unavailable(); }
    if (!row.allowed) throw Object.assign(new Error(`Лимит переводов за ${name==='day'?'24 часа':'30 дней'} исчерпан.`),{status:429});
  }
}
module.exports = { consumeTranslationQuota };
