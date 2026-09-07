// Трекинг явных "пакетов" документов для публичного API (webhook "пакет
// завершён") — см. api/v1/batch.js. В отличие от лимита страниц
// (customFieldsLookup.js:consumeUsage), это НЕ обязательная проверка перед
// вызовом Gemini — весь модуль на пути "лучше не сработает, чем сломает
// распознавание": ошибка Supabase здесь никогда не должна помешать вернуть
// клиенту результат распознавания документа. Каждая функция ловит свои
// ошибки сама и возвращает { ok: false, reason: 'error' } вместо throw.
//
// Три RPC-функции в Postgres (см. миграцию tamga_batch_functions) делают
// всю атомарность (SELECT ... FOR UPDATE) — этот модуль только вызывает их
// через Supabase REST с service role key, как и остальной customFieldsLookup.js.

async function callRpc(fnName, args) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, reason: 'not_configured' };
  }
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
      console.error(`webhookBatches: ${fnName} вернул`, res.status);
      return { ok: false, reason: 'error' };
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row || { ok: false, reason: 'error' };
  } catch (err) {
    console.error(`webhookBatches: ошибка запроса ${fnName}:`, err.message);
    return { ok: false, reason: 'error' };
  }
}

// Создаёт новый пакет для данного api_key. Возвращает { ok: true, batchId,
// createdAt } или { ok: false, reason }. reason === 'not_configured' — Supabase
// не настроен (fail-closed для ЭТОГО конкретного эндпоинта осознанно: без
// Supabase негде хранить состояние пакета, лучше явная ошибка клиенту
// интеграции, чем притвориться, что пакет создан).
async function createBatch(apiKey) {
  const row = await callRpc('create_batch', { p_api_key: apiKey });
  if (!row || !row.batch_id) return { ok: false, reason: row?.reason || 'error' };
  return { ok: true, batchId: row.batch_id, createdAt: row.created_at };
}

// Засчитывает один документ в пакет. НИКОГДА не бросает — вызывающий код
// (lib/recognize.js) обязан игнорировать ok:false здесь (кроме логирования)
// и всё равно вернуть результат распознавания клиенту.
async function recordBatchDocument({ batchId, apiKey, docType, success }) {
  if (!batchId) return { ok: false, reason: 'no_batch' };
  const row = await callRpc('record_batch_document', {
    p_batch_id: batchId, p_api_key: apiKey, p_doc_type: docType || null, p_success: !!success
  });
  return { ok: !!row.ok, reason: row.reason || null };
}

// Закрывает пакет и возвращает сводку для вебхука. reason: 'not_found' |
// 'forbidden' | 'already_closed' (в этом случае сводка тоже возвращается —
// см. комментарий в SQL-функции про идемпотентность) | 'error'.
async function finishBatch({ batchId, apiKey }) {
  const row = await callRpc('finish_batch', { p_batch_id: batchId, p_api_key: apiKey });
  return {
    ok: !!row.ok,
    reason: row.reason || null,
    documentCount: row.document_count ?? null,
    errorCount: row.error_count ?? null,
    docTypeCounts: row.doc_type_counts || null,
    createdAt: row.created_at || null,
    closedAt: row.closed_at || null
  };
}

// Отмечает итог попытки доставки вебхука — только для видимости в логах/будущей
// админке, сама доставка (lib/webhooks.js) уже произошла к этому моменту.
async function recordWebhookDelivery({ batchId, delivered, attempts, lastError }) {
  await callRpc('record_webhook_delivery', {
    p_batch_id: batchId, p_delivered: !!delivered, p_attempts: attempts || 0, p_last_error: lastError || null
  });
}

module.exports = { createBatch, recordBatchDocument, finishBatch, recordWebhookDelivery };
