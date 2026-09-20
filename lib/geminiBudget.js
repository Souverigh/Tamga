// Shared database reservation, including both recognition stages and all instances.
async function reserveGeminiBudget({ mimeType, instruction }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const unavailable = () => Object.assign(new Error('Gemini budget unavailable'), { status: 503 });
  if (!url || !key) throw unavailable();
  const positive = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  // Conservative reservations, not measurements of model billing.
  const tokens = (mimeType === 'application/pdf' ? 1048576 : 32768) + 8192 + String(instruction).length;
  let row;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/tamga_reserve_gemini_budget`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_tokens: tokens, p_rpm: positive(process.env.GEMINI_SERVER_RPM, 300), p_tpm: positive(process.env.GEMINI_SERVER_TPM, 8000000) })
    });
    if (!response.ok) throw unavailable();
    const data = await response.json();
    row = Array.isArray(data) ? data[0] : data;
    if (typeof row?.allowed !== 'boolean') throw unavailable();
  } catch (_) { throw unavailable(); }
  if (!row.allowed) throw Object.assign(new Error('Общий лимит распознавания исчерпан, повторите позже'), { status: 429 });
}
module.exports = { reserveGeminiBudget };
