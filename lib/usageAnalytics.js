// Аналитика использования по клиенту — премиум-функция (Ethan, 7 сен 2026,
// "аналитика по клиенту давай", второй пункт из брейнштормленного списка
// после сводного отчёта). Отдельный модуль от usageLogging.js (тот пишет
// только в stdout/Vercel Logs — не агрегируется), потому что здесь запись
// идёт в Supabase (персистентный агрегат, читаемый обратно для дашборда),
// а не просто console.log.
//
// Тот же принцип "никогда не хранить содержимое документа", что и везде в
// проекте (см. usageLogging.js) — таблица tamga_usage_daily хранит ТОЛЬКО
// метаданные (счётчики, токены, задержка, уверенность), см. миграцию
// tamga_usage_daily. client_ref хранится в открытом виде (не хешируется) —
// это не новая граница чувствительности: tamga_api_key_fields.api_key и
// tamga_batches.api_key уже хранятся в открытом виде для точного поиска.
//
// Область (Ethan, 7 сен 2026, "В /admin — только вы, когда открываете
// карточку клиента") — на старте только админский просмотр, без отдельной
// клиентской страницы и без нового публичного эндпоинта.
//
// Fail-safe по конструкции, как webhookBatches.js: запись НИКОГДА не должна
// сломать сам ответ распознавания. Чтение (для админки) тоже не бросает —
// недоступность Supabase просто означает "аналитика пока не загрузилась",
// а не 500 на всю карточку клиента.

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
      console.error(`usageAnalytics: ${fnName} вернул`, res.status);
      return { ok: false, reason: 'error' };
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row ? { ok: true, row } : { ok: false, reason: 'error' };
  } catch (err) {
    console.error(`usageAnalytics: ошибка запроса ${fnName}:`, err.message);
    return { ok: false, reason: 'error' };
  }
}

// Записывает один вызов распознавания в дневной агрегат. НИКОГДА не бросает —
// вызывающий код (lib/recognize.js) обязан игнорировать ok:false здесь (кроме
// логирования) и всё равно вернуть результат распознавания клиенту.
//
// clientRef — apiKey либо clientSlug (ровно один из них, см. recognize.js) —
// тот канал, через который реально пришёл этот конкретный запрос.
async function recordUsageEvent({ clientRef, docType, success, confidence, promptTokens, outputTokens, totalTokens, latencyMs }) {
  if (!clientRef) return { ok: false, reason: 'no_client_ref' };
  const outcome = await callRpc('record_usage_event', {
    p_client_ref: clientRef,
    p_doc_type: docType || null,
    p_success: !!success,
    p_confidence: confidence == null ? null : confidence,
    p_prompt_tokens: promptTokens == null ? null : promptTokens,
    p_output_tokens: outputTokens == null ? null : outputTokens,
    p_total_tokens: totalTokens == null ? null : totalTokens,
    p_latency_ms: latencyMs == null ? null : latencyMs
  });
  return { ok: outcome.ok, reason: outcome.reason || null };
}

// Читает агрегат за последние days дней для одного client_ref. Возвращает
// null при недоступности Supabase/ошибке (админка показывает "не удалось
// загрузить", не падает) или если для этого client_ref вообще нет данных
// (запросов не было — тоже null, отличать от "Supabase упал" админке не нужно).
async function getUsageSummaryForRef(clientRef, days) {
  if (!clientRef) return null;
  const outcome = await callRpc('get_usage_summary', { p_client_ref: clientRef, p_days: days });
  if (!outcome.ok) return null;
  const row = outcome.row;
  if (!row || Number(row.total_requests) === 0) return null;
  return {
    totalRequests: Number(row.total_requests) || 0,
    totalErrors: Number(row.total_errors) || 0,
    avgConfidence: row.avg_confidence == null ? null : Number(row.avg_confidence),
    totalPromptTokens: Number(row.total_prompt_tokens) || 0,
    totalOutputTokens: Number(row.total_output_tokens) || 0,
    totalTokens: Number(row.total_tokens) || 0,
    avgLatencyMs: row.avg_latency_ms == null ? null : Number(row.avg_latency_ms),
    byType: row.by_type && typeof row.by_type === 'object' ? row.by_type : {}
  };
}

// Один клиент (строка tamga_api_key_fields) может иметь И api_key, И
// client_slug одновременно — обслуживать и API-интеграцию, и веб-доступ
// одной записью (см. customFieldsLookup.js). Запросы через разные каналы
// попадают в РАЗНЫЕ client_ref в tamga_usage_daily (см. recognize.js — пишем
// под тем идентификатором, каким реально пришёл запрос), поэтому для полной
// картины по клиенту читаем оба и складываем.
//
// Приближение: avgConfidence/avgLatencyMs при слиянии двух источников
// взвешиваются по totalRequests каждого (не по точному confidence_count/
// latency_count, которых get_usage_summary не возвращает) — для подавляющего
// большинства клиентов задан только ОДИН канал (api_key ИЛИ client_slug), и
// тогда это не приближение, а точное число; расхождение возможно только у
// клиентов, использующих оба канала одновременно.
function mergeSummaries(a, b) {
  if (!a) return b;
  if (!b) return a;
  const totalRequests = a.totalRequests + b.totalRequests;
  const weightedAvg = (valA, weightA, valB, weightB) => {
    if (valA == null && valB == null) return null;
    if (valA == null) return valB;
    if (valB == null) return valA;
    const totalWeight = weightA + weightB;
    return totalWeight > 0 ? (valA * weightA + valB * weightB) / totalWeight : null;
  };
  const byType = { ...a.byType };
  for (const [type, count] of Object.entries(b.byType)) {
    byType[type] = (byType[type] || 0) + count;
  }
  return {
    totalRequests,
    totalErrors: a.totalErrors + b.totalErrors,
    avgConfidence: weightedAvg(a.avgConfidence, a.totalRequests, b.avgConfidence, b.totalRequests),
    totalPromptTokens: a.totalPromptTokens + b.totalPromptTokens,
    totalOutputTokens: a.totalOutputTokens + b.totalOutputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    avgLatencyMs: weightedAvg(a.avgLatencyMs, a.totalRequests, b.avgLatencyMs, b.totalRequests),
    byType
  };
}

// apiKey/clientSlug — из строки tamga_api_key_fields (может быть задано одно,
// другое или оба, см. mergeSummaries выше). days — окно агрегации (админка
// передаёт фиксированные 30). Возвращает null, если данных нет ни по одному
// каналу (включая "Supabase недоступен") — админка показывает заглушку.
async function getUsageSummary({ apiKey, clientSlug, days = 30 }) {
  const [byKey, bySlug] = await Promise.all([
    getUsageSummaryForRef(apiKey || null, days),
    getUsageSummaryForRef(clientSlug || null, days)
  ]);
  return mergeSummaries(byKey, bySlug);
}

module.exports = { recordUsageEvent, getUsageSummary };
