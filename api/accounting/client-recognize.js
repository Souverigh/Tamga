const { recognizeAccountingDocument, AccountingError } = require('../../lib/accounting/pipeline');
const { recordAccountingDocument } = require('../../lib/accounting/storage');
const { requirePaidAccountingClient } = require('../../lib/accounting/clientAccess');
const { readRequestBody } = require('../../lib/multipart');
const { render } = require('../../lib/accounting/i18n');

// POST /api/accounting/client-recognize — модуль бухгалтерии для платных
// клиентов Tamga из веб-панели сайта (public/js/accounting/panel.js), рядом
// с уже существующим /api/recognize (Ethan, 15 сен 2026: "добавить модуль
// бухгалтерии для платных клиентов").
//
// Гейт — requirePaidAccountingClient (lib/accounting/clientAccess.js), тот же
// паттерн, что requirePaidTranslationClient у api/translate.js: нужен
// настроенный clientSlug (платный пакет) И валидный x-client-token на этот
// slug — знания одного slug недостаточно, даже если у клиента вообще нет
// пароля на сам сайт (см. комментарий в lib/clientAuth.js:
// requireClientSettingsAuth).
//
// Тело: { image: base64, mimeType, clientSlug } — clientSlug ОБЯЗАТЕЛЕН
// (в отличие от api/recognize.js, где он необязателен для анонимных
// посетителей) — эта панель никогда не показывается без него, см. panel.js.
// Списывает ТУ ЖЕ страницу пакета (page_limit/pages_used), что обычное
// распознавание этого клиента — общий лимит, не отдельная квота.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  try {
    const { image, mimeType, clientSlug } = await readRequestBody(req);
    const slug = await requirePaidAccountingClient(req, clientSlug);
    const apiKey = process.env.GEMINI_API_KEY;

    const recognition = await recognizeAccountingDocument({ base64: image, mimeType, apiKey, clientSlug: slug });

    const documentId = await recordAccountingDocument({
      clientRef: slug,
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
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status !== 500) {
      res.status(status).json({ error: error.message });
      return;
    }
    console.error('[accounting/client-recognize] unexpected error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
