const { recognizeAndTranslateDocument, TranslationDocError } = require('../../../lib/translationDocs/pipeline');
const { checkApiKey } = require('../../../lib/apiKeyAuth');
const { readRequestBody } = require('../../../lib/multipart');

// POST /api/v1/translation-docs/recognize — модуль "Перевод" (апостиль и
// далее другие типы документов, см. TYPE_REGISTRY в
// lib/translationDocs/pipeline.js) для ПЛАТНЫХ КЛИЕНТОВ Tamga, рядом с
// /api/v1/recognize и /api/v1/accounting/recognize.
//
// Тот же x-api-key/TAMGA_API_KEYS, что и /api/v1/recognize и
// /api/v1/accounting/recognize: любой существующий платный клиент Tamga
// получает доступ без отдельного онбординга, и списывается ТОТ ЖЕ пакет
// страниц (page_limit/pages_used) — "общий лимит с обычным распознаванием",
// как попросил Ethan (16 сен 2026), а не отдельная квота (сравните с
// lib/translationQuota.js — там сознательно отдельный счётчик; здесь —
// сознательно тот же самый, что у recognize/accounting).
//
// Заголовки: x-api-key: <ваш ключ>, Content-Type: application/json
// Тело:      { "image": "<base64>", "mimeType": "image/png", "language": "en" }
// language — один из кодов lib/translation.js:LANGUAGES (ru/ky/en/kk/uz/tr/zh/de).
// Тип документа определяется автоматически моделью — doc_type параметром не
// передаётся.
// Ответ: { doc_type, language, fields: [{ key, label, value, raw_text,
//          confidence, translated }] }
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
    const { image, mimeType, sourceText, language } = await readRequestBody(req);
    const clientApiKey = req.headers['x-api-key'];
    const apiKey = process.env.GEMINI_API_KEY;

    const recognition = await recognizeAndTranslateDocument({ base64: image, mimeType, sourceText, apiKey, language, clientApiKey });

    res.status(200).json({
      doc_type: recognition.docType,
      language: recognition.language,
      sourceLanguage: recognition.sourceLanguage,
      regulation: recognition.regulation,
      fields: recognition.fields.map(f => ({
        key: f.key, label: f.label, targetLabel: f.targetLabel, value: f.value, raw_text: f.rawText, confidence: f.confidence, translated: f.translated, translationStatus: f.translationStatus,
        requiresReview: f.requiresReview, reviewReason: f.reviewReason, verificationCandidate: f.verificationCandidate
      })),
      ...(Array.isArray(recognition.elements) ? { elements: recognition.elements.map(e => ({
        key: e.key, type: e.elementType, number: e.number || null, label: e.label,
        targetLabel: e.targetLabel, value: e.value, translated: e.translated,
        raw_text: e.rawText, confidence: e.confidence, requiresReview: e.requiresReview, reviewReason: e.reviewReason
      })) } : {})
    });
  } catch (error) {
    if (error instanceof TranslationDocError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status !== 500) {
      res.status(status).json({ error: error.message });
      return;
    }
    console.error('[v1/translation-docs/recognize] unexpected error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
