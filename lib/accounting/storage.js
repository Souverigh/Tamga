// Запись в Supabase — RPC-функции record_accounting_document /
// record_accounting_correction (см. миграцию accounting_rpc_and_grants).
// Fail-safe по тому же принципу, что lib/usageAnalytics.js /
// lib/webhookBatches.js: сбой записи никогда не должен сломать ответ API —
// только залогировать и вернуть { ok: false }.

async function callRpc(fnName, args) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args)
    });
    if (!res.ok) {
      console.error(`[accounting] ${fnName} failed: ${res.status} ${await res.text().catch(() => '')}`);
      return { ok: false, reason: 'http_error', status: res.status };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    console.error(`[accounting] ${fnName} error:`, err.message);
    return { ok: false, reason: 'exception' };
  }
}

// doc — { header, items } as built by document.js (raw provenance fields).
// normalized — doc.normalized. results — output of runRules(). Returns the
// new document's UUID, or null if the write failed (caller must not throw —
// see recognize.js call site).
async function recordAccountingDocument({ clientRef, docType, header, items, normalized, results, overallStatus }) {
  const outcome = await callRpc('record_accounting_document', {
    p_client_ref: clientRef || null,
    p_doc_type: docType,
    p_header: header,
    p_header_normalized: normalized.header,
    p_items: items,
    p_items_normalized: normalized.items,
    p_overall_status: overallStatus,
    p_rule_results: results
  });
  if (!outcome.ok) return null;
  return outcome.data; // RPC returns the uuid directly
}

async function recordAccountingCorrection({ documentId, field, modelValue, correctedValue, modelConfidence }) {
  const outcome = await callRpc('record_accounting_correction', {
    p_document_id: documentId,
    p_field: field,
    p_model_value: modelValue != null ? String(modelValue) : null,
    p_corrected_value: String(correctedValue),
    p_model_confidence: modelConfidence != null ? Math.round(modelConfidence) : null
  });
  return outcome.ok;
}

module.exports = { recordAccountingDocument, recordAccountingCorrection };
