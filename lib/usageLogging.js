// Структурированное логирование метрик каждого вызова Gemini — токены, задержка,
// тип документа, уверенность и т.п. Одной JSON-строкой в stdout (console.log) —
// Vercel сам собирает stdout serverless-функций в Runtime Logs, отдельная
// инфраструктура логирования/аналитики для текущего объёма избыточна (тот же
// принцип, что и с in-memory кэшем в customFieldsLookup.js).
//
// ВАЖНО: сюда никогда не должно попадать содержимое документа — ни текст
// (parsed.text), ни значения извлечённых полей (parsed.fields/items), ни
// сырой base64 картинки. Только метаданные вызова: сколько токенов ушло,
// сколько заняло по времени, какой тип документа определился, какая
// уверенность — этого достаточно и для анализа стоимости (см. обсуждение
// 7 сен 2026 про 3000 сом / 1000 страниц), и для будущего мониторинга
// качества (например, "у каких типов документов confidence стабильно ниже"),
// без риска утечки персональных данных клиента через логи.
//
// event — строка-тег для фильтрации в Vercel Logs / get_runtime_logs (MCP):
// 'tamga_recognize' — успешный вызов, 'tamga_recognize_error' — сбой.

const crypto = require('crypto');

// API-ключ клиента — секрет уровня пароля, в логи в открытом виде не идёт.
// Короткий хеш достаточен, чтобы отличить одного клиента от другого и
// посчитать объём/стоимость по клиенту, не давая возможности восстановить
// сам ключ из лога (тот же принцип, что hashIp в anonymousUsage.js).
function hashIdentifier(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function clientTag({ clientSlug, clientApiKey, clientIp }) {
  if (clientSlug) return `slug:${clientSlug}`;
  if (clientApiKey) return `key:${hashIdentifier(clientApiKey)}`;
  if (clientIp) return `ip:${hashIdentifier(clientIp)}`;
  return 'anonymous';
}

// usage — сырой usageMetadata из ответа Gemini (см. geminiClient.js), может
// быть null (например, API вообще не вернул его — не должно ронять лог).
function logRecognition({ docType, confidence, tableMode, skipOcr, usage, latencyMs, clientSlug, clientApiKey, clientIp }) {
  try {
    console.log(JSON.stringify({
      event: 'tamga_recognize',
      docType: docType || null,
      confidence: confidence === undefined ? null : confidence,
      tableMode: !!tableMode,
      skipOcr: !!skipOcr,
      promptTokens: usage ? (usage.promptTokenCount ?? null) : null,
      outputTokens: usage ? (usage.candidatesTokenCount ?? null) : null,
      totalTokens: usage ? (usage.totalTokenCount ?? null) : null,
      latencyMs,
      client: clientTag({ clientSlug, clientApiKey, clientIp })
    }));
  } catch (_) {
    // Логирование не должно ронять запрос ни при каких обстоятельствах.
  }
}

function logRecognitionError({ status, message, latencyMs, clientSlug, clientApiKey, clientIp }) {
  try {
    console.log(JSON.stringify({
      event: 'tamga_recognize_error',
      status: status || null,
      message: message || null,
      latencyMs,
      client: clientTag({ clientSlug, clientApiKey, clientIp })
    }));
  } catch (_) {
    // см. выше
  }
}

// Итог попытки доставки вебхука "пакет завершён" (см. lib/webhooks.js) —
// event: 'tamga_webhook_delivery'. batchId в открытом виде (не секрет, в
// отличие от api-ключа) — удобно искать конкретную доставку в логах по
// batchId, который клиент получил в ответ на /api/v1/batch.
function logWebhookDelivery({ batchId, delivered, attempts, lastError, documentCount, clientApiKey }) {
  try {
    console.log(JSON.stringify({
      event: 'tamga_webhook_delivery',
      batchId: batchId || null,
      delivered: !!delivered,
      attempts: attempts || 0,
      lastError: lastError || null,
      documentCount: documentCount === undefined ? null : documentCount,
      client: clientTag({ clientApiKey })
    }));
  } catch (_) {
    // см. выше
  }
}

module.exports = { logRecognition, logRecognitionError, logWebhookDelivery, hashIdentifier };
