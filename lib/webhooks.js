// Доставка вебхука "пакет завершён" (batch.completed) — см. api/v1/batch.js
// и TECH_DEBT.md ("Вебхуки"). Синхронно, внутри самого запроса finish —
// отдельной очереди/повторной доставки в фоне НЕТ (maxDuration функций уже
// 300с — с запасом хватает на несколько попыток), см. обсуждение в
// TECH_DEBT.md почему это осознанный компромисс, а не недосмотр.
//
// Подпись HMAC-SHA256 по сырому телу запроса — стандартная практика (как у
// Stripe/GitHub), чтобы принимающая сторона могла убедиться, что вебхук
// реально от Тамги, а не подделан кем-то, кто узнал её URL.

const crypto = require('crypto');

const TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [0, 2000, 5000]; // 3 попытки: сразу, потом +2с, потом +5с

function buildPayload({ batchId, documentCount, errorCount, docTypeCounts, createdAt, closedAt }) {
  return JSON.stringify({
    event: 'batch.completed',
    batchId,
    documentCount,
    errorCount,
    docTypeCounts: docTypeCounts || {},
    createdAt,
    closedAt,
    deliveredAt: new Date().toISOString()
  });
}

function sign(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function attemptDelivery(url, body, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'таймаут' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// batch — сводка из webhookBatches.js:finishBatch (documentCount/errorCount/
// docTypeCounts/createdAt/closedAt). webhookUrl/webhookSecret — из
// clientConfig.formatting (см. lib/customFieldsLookup.js), не отдельная
// колонка (тот же принцип, что и с maxConcurrency — переиспользуем formatting
// JSONB вместо миграции). Секрет НЕОБЯЗАТЕЛЕН: без него подпись не добавляется
// (администратор явно решает, включать проверку подлинности или нет).
//
// Возвращает { attempted, delivered, attempts, lastError } — attempted:false
// значит webhookUrl вообще не задан для этого клиента, попытки не было.
async function deliverBatchWebhook({ webhookUrl, webhookSecret, batchId, documentCount, errorCount, docTypeCounts, createdAt, closedAt }) {
  if (!webhookUrl) {
    return { attempted: false, delivered: false, attempts: 0, lastError: null };
  }

  const body = buildPayload({ batchId, documentCount, errorCount, docTypeCounts, createdAt, closedAt });
  const headers = { 'Content-Type': 'application/json', 'X-Tamga-Event': 'batch.completed' };
  if (webhookSecret) {
    headers['X-Tamga-Signature'] = `sha256=${sign(body, webhookSecret)}`;
  }

  let lastError = null;
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    if (RETRY_DELAYS_MS[i] > 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[i]));
    }
    const result = await attemptDelivery(webhookUrl, body, headers);
    if (result.ok) {
      return { attempted: true, delivered: true, attempts: i + 1, lastError: null };
    }
    lastError = result.error;
  }
  return { attempted: true, delivered: false, attempts: RETRY_DELAYS_MS.length, lastError };
}

module.exports = { deliverBatchWebhook, buildPayload, sign };
