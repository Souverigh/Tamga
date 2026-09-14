const { recognizeEsf, AccountingError } = require('../../lib/accounting/pipeline');
const { recordAccountingDocument } = require('../../lib/accounting/storage');
const { checkAccountingApiKey } = require('../../lib/accounting/apiKeyAuth');
const { readRequestBody } = require('../../lib/multipart');

// POST /api/accounting/recognize — публичный API модуля бухгалтерии.
// Отдельный периметр от /api/recognize и /api/v1/recognize (см.
// lib/accounting/apiKeyAuth.js) — свой заголовок x-api-key, своя переменная
// окружения ACCOUNTING_API_KEYS на Vercel (Ethan должен завести её отдельно
// от TAMGA_API_KEYS перед первым реальным вызовом).
//
// Тело запроса: { image: base64, mimeType } — как /api/recognize, но БЕЗ
// docType (пока только 'esf' в ACCOUNTING_DOC_TYPES — выбирать нечего) и
// БЕЗ clientSlug/clientConfig (нет кастомных полей/клиентских правил в этом
// первом срезе — только детерминированные INV-001..006).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  const auth = checkAccountingApiKey(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message });
    return;
  }

  try {
    const { image, mimeType } = await readRequestBody(req);
    const apiKey = process.env.GEMINI_API_KEY;

    const recognition = await recognizeEsf({ base64: image, mimeType, apiKey });

    // Запись в Supabase — fail-safe (см. storage.js): если не удалось, ответ
    // всё равно уходит клиенту, просто без document_id (нечего исправлять
    // через /api/accounting/correction позже). Как и в остальном проекте,
    // аналитика/персистентность никогда не должна ронять сам ответ.
    const documentId = await recordAccountingDocument({
      clientRef: auth.clientRef,
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
      validation: recognition.results
    });
  } catch (error) {
    if (error instanceof AccountingError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('[accounting/recognize] unexpected error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
