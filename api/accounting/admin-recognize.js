const { recognizeEsf, AccountingError } = require('../../lib/accounting/pipeline');
const { recordAccountingDocument } = require('../../lib/accounting/storage');
const { checkAdminSecret } = require('../../lib/adminAuth');
const { readRequestBody } = require('../../lib/multipart');
const { render } = require('../../lib/accounting/i18n');

// POST /api/accounting/admin-recognize — для внутреннего review-интерфейса
// (public/admin/accounting.html), ОТДЕЛЬНЫЙ от публичного
// /api/accounting/recognize (тот требует x-api-key/ACCOUNTING_API_KEYS —
// правильный периметр для внешних интеграций, но подставлять такой ключ в
// браузерный JS публичной страницы небезопасно, он был бы виден каждому).
//
// Здесь вместо этого — уже существующий x-admin-secret (lib/adminAuth.js,
// тот же секрет, что у /admin), с троттлингом попыток и fail-closed поведением
// "из коробки". checkAdminSecret не знает про тип документа и не менялся —
// безопасное read-only переиспользование.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  const auth = await checkAdminSecret(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }

  try {
    const { image, mimeType } = await readRequestBody(req);
    const apiKey = process.env.GEMINI_API_KEY;

    const recognition = await recognizeEsf({ base64: image, mimeType, apiKey });

    const documentId = await recordAccountingDocument({
      clientRef: 'admin-review',
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
      // message — уже отрендеренный текст (см. lib/accounting/i18n), чтобы
      // браузерной странице (public/admin/accounting.js) не тащить свою
      // копию словаря/render() — она только для UI, серверный ответ остаётся
      // источником истины (message_key/params тоже возвращаются как есть).
      validation: recognition.results.map(r => ({ ...r, message: r.message_key ? render(r.message_key, r.params) : null }))
    });
  } catch (error) {
    if (error instanceof AccountingError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('[accounting/admin-recognize] unexpected error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
