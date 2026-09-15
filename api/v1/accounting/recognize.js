const { recognizeAccountingDocument, AccountingError } = require('../../../lib/accounting/pipeline');
const { recordAccountingDocument } = require('../../../lib/accounting/storage');
const { checkApiKey } = require('../../../lib/apiKeyAuth');
const { readRequestBody } = require('../../../lib/multipart');
const { render } = require('../../../lib/accounting/i18n');

// POST /api/v1/accounting/recognize — модуль бухгалтерии для ПЛАТНЫХ
// КЛИЕНТОВ Tamga (Ethan, 15 сен 2026: "добавить модуль бухгалтерии для
// платных клиентов"), рядом с уже существующим /api/v1/recognize.
//
// ВАЖНО: это ДРУГОЙ периметр, чем /api/accounting/recognize (тот проверяет
// x-api-key по отдельному списку ACCOUNTING_API_KEYS — для внешней аудитории
// бухгалтеров-валидаторов, см. комментарий в lib/accounting/apiKeyAuth.js).
// Здесь — ТОТ ЖЕ x-api-key/TAMGA_API_KEYS, что и /api/v1/recognize: любой
// существующий платный клиент Tamga получает доступ без отдельного
// онбординга, и списывается ТОТ ЖЕ пакет страниц (page_limit/pages_used) —
// "общий лимит с обычным распознаванием", как попросил Ethan, а не отдельная
// квота (сравните с lib/translationQuota.js — там сознательно отдельный
// счётчик; здесь — сознательно тот же самый).
//
// Заголовки: x-api-key: <ваш ключ>, Content-Type: application/json
// Тело:      { "image": "<base64>", "mimeType": "image/png" }
// Тип документа определяется автоматически моделью (ЭСФ / Товарная
// накладная / Акт выполненных работ / Платёжное поручение) — docType
// параметром не передаётся, выбирать пока не из чего вне этой четвёрки.
// Ответ: { document_id, doc_type, overall_status, header, items, normalized,
//          validation: [{ rule_id, status, message, ... }] } — та же форма,
// что у /api/accounting/recognize (см. его комментарии).
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

  try {
    const { image, mimeType } = await readRequestBody(req);
    const clientApiKey = req.headers['x-api-key'];
    const apiKey = process.env.GEMINI_API_KEY;

    const recognition = await recognizeAccountingDocument({ base64: image, mimeType, apiKey, clientApiKey });

    const documentId = await recordAccountingDocument({
      clientRef: clientApiKey,
      docType: recognition.docType,
      header: recognition.header,
      items: recognition.items,
      normalized: recognition.normalized,
      results: recognition.results,
      overallStatus: recognition.overallStatus
    });

    res.status(200).json({
      document_id: documentId,
      doc_type: recognition.docType,
      overall_status: recognition.overallStatus,
      header: recognition.header,
      items: recognition.items,
      normalized: recognition.normalized,
      validation: recognition.results.map(r => ({ ...r, message: r.message_key ? render(r.message_key, r.params) : null }))
    });
  } catch (error) {
    if (error instanceof AccountingError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('[v1/accounting/recognize] unexpected error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
