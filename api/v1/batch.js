const { checkApiKey } = require('../../lib/apiKeyAuth');
const { createBatch, finishBatch, recordWebhookDelivery } = require('../../lib/webhookBatches');
const { deliverBatchWebhook } = require('../../lib/webhooks');
const { logWebhookDelivery } = require('../../lib/usageLogging');
const { getClientConfig } = require('../../lib/customFieldsLookup');

// Явные пакеты документов для публичного API — см. TECH_DEBT.md ("Вебхуки").
// Сервер НЕ угадывает конец пакета по паузе между вызовами — вы сами
// открываете и закрываете пакет, поэтому "пакет завершён" означает ровно то,
// что вы имели в виду, а не эвристику.
//
// POST /api/v1/batch
// Заголовки: x-api-key: <ваш ключ>
//
// 1) Открыть пакет — тело {} (или без тела):
//    Ответ: { "batchId": "batch_...", "createdAt": "..." }
//    Передавайте этот batchId в поле "batchId" каждого вызова
//    POST /api/v1/recognize, который относится к этому пакету.
//
// 2) Закрыть пакет — тело { "batchId": "batch_...", "finish": true }:
//    Ответ: { "batchId", "documentCount", "errorCount", "docTypeCounts",
//              "createdAt", "closedAt", "webhookAttempted", "webhookDelivered" }
//    Если для вашего x-api-key в /admin настроен webhookUrl — на него сразу
//    (синхронно, в рамках этого запроса) уходит POST-запрос:
//      { "event": "batch.completed", "batchId", "documentCount", "errorCount",
//        "docTypeCounts", "createdAt", "closedAt", "deliveredAt" }
//    с заголовком X-Tamga-Event: batch.completed и, если настроен секрет,
//    X-Tamga-Signature: sha256=<HMAC-SHA256 тела запроса>. До 3 попыток
//    доставки с задержкой — если все не удались, closedAt/сводка в ОТВЕТЕ
//    этого запроса всё равно корректны (пакет закрыт), просто webhookDelivered
//    будет false — переспросить вебхук нельзя (повторный finish на закрытом
//    пакете не переотправляет его, см. ниже), поэтому проверяйте это поле.
//
//    Повторный вызов finish на уже закрытом пакете — не ошибка (на случай,
//    если ваш прошлый вызов оборвался по сети до того, как вы увидели ответ):
//    возвращает ту же сводку с "alreadyClosed": true, но вебхук ПОВТОРНО НЕ
//    отправляет — иначе клиент получил бы дубликат оповещения.
//
// docTypeCounts — только метаданные (сколько документов какого типа), без
// содержимого документов — тот же принцип, что и в lib/usageLogging.js.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  const auth = checkApiKey(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }
  const apiKey = req.headers['x-api-key'];
  const { batchId, finish } = req.body || {};

  try {
    // "finish": true без batchId — явная ошибка запроса, а не "создать пакет"
    // (batchId отсутствует в обоих случаях, поэтому эту проверку нужно делать
    // ДО ветки создания — иначе опечатка вида { finish: true } без batchId
    // молча создала бы новый пакет вместо понятной ошибки).
    if (finish && !batchId) {
      res.status(400).json({ error: 'Для "finish": true нужно передать batchId закрываемого пакета' });
      return;
    }

    if (!batchId) {
      const created = await createBatch(apiKey);
      if (!created.ok) {
        res.status(503).json({ error: 'Не удалось создать пакет — сервис временно недоступен, попробуйте позже' });
        return;
      }
      res.status(200).json({ batchId: created.batchId, createdAt: created.createdAt });
      return;
    }

    if (!finish) {
      res.status(400).json({ error: 'Для существующего batchId укажите "finish": true — открыть новый пакет можно только без batchId' });
      return;
    }

    const result = await finishBatch({ batchId, apiKey });
    if (!result.ok && result.reason === 'not_found') {
      res.status(404).json({ error: 'Пакет с таким batchId не найден' });
      return;
    }
    if (!result.ok && result.reason === 'forbidden') {
      res.status(403).json({ error: 'Этот пакет создан другим x-api-key' });
      return;
    }
    if (!result.ok && result.reason === 'already_closed') {
      res.status(200).json({
        batchId,
        documentCount: result.documentCount,
        errorCount: result.errorCount,
        docTypeCounts: result.docTypeCounts,
        createdAt: result.createdAt,
        closedAt: result.closedAt,
        alreadyClosed: true,
        webhookAttempted: false,
        webhookDelivered: false
      });
      return;
    }
    if (!result.ok) {
      res.status(503).json({ error: 'Не удалось закрыть пакет — сервис временно недоступен, попробуйте позже' });
      return;
    }

    // Куда слать вебхук — из конфига клиента (formatting.webhookUrl/webhookSecret,
    // см. /admin, тот же JSONB, что и maxConcurrency). Нет конфига или URL не
    // задан — webhookAttempted просто будет false, пакет всё равно закрыт корректно.
    const clientConfig = await getClientConfig({ apiKey });
    const webhookUrl = clientConfig?.formatting?.webhookUrl || null;
    const webhookSecret = clientConfig?.formatting?.webhookSecret || null;

    const delivery = await deliverBatchWebhook({
      webhookUrl, webhookSecret, batchId,
      documentCount: result.documentCount, errorCount: result.errorCount,
      docTypeCounts: result.docTypeCounts, createdAt: result.createdAt, closedAt: result.closedAt
    });
    logWebhookDelivery({
      batchId, delivered: delivery.delivered, attempts: delivery.attempts,
      lastError: delivery.lastError, documentCount: result.documentCount, clientApiKey: apiKey
    });
    if (delivery.attempted) {
      await recordWebhookDelivery({ batchId, delivered: delivery.delivered, attempts: delivery.attempts, lastError: delivery.lastError });
    }

    res.status(200).json({
      batchId,
      documentCount: result.documentCount,
      errorCount: result.errorCount,
      docTypeCounts: result.docTypeCounts,
      createdAt: result.createdAt,
      closedAt: result.closedAt,
      webhookAttempted: delivery.attempted,
      webhookDelivered: delivery.delivered
    });
  } catch (err) {
    console.error('v1/batch error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
