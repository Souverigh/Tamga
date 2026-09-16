const { recognizeAndTranslateDocument, TranslationDocError } = require('../../lib/translationDocs/pipeline');
const { requirePaidTranslationClient } = require('../../lib/translationAccess');
const { readRequestBody } = require('../../lib/multipart');

// POST /api/translation-docs/client-recognize — модуль "Перевод" (апостиль
// и далее другие типы документов) для платных клиентов Tamga из веб-панели
// сайта (public/js/translationDocs/panel.js), рядом с
// /api/accounting/client-recognize.
//
// Гейт — requirePaidTranslationClient (lib/translationAccess.js), тот же,
// что раньше использовал /api/translate.js для сегментов из уже
// распознанного документа: нужен настроенный clientSlug (платный пакет) И
// валидный x-client-token на этот slug.
//
// Тело: { image: base64, mimeType, clientSlug, language } — clientSlug и
// language ОБЯЗАТЕЛЬНЫ (панель никогда не показывается без клиента, язык —
// выбор пользователя в интерфейсе). Списывает ТУ ЖЕ страницу пакета
// (page_limit/pages_used), что обычное распознавание этого клиента —
// общий лимит, не отдельная квота (Ethan, 16 сен 2026).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  try {
    const { image, mimeType, clientSlug, language, pageCount } = await readRequestBody(req);
    const slug = await requirePaidTranslationClient(req, clientSlug);
    const apiKey = process.env.GEMINI_API_KEY;

    const recognition = await recognizeAndTranslateDocument({ base64: image, mimeType, apiKey, language, clientSlug: slug, pageCount });

    res.status(200).json({
      doc_type: recognition.docType,
      language: recognition.language,
      fields: recognition.fields.map(f => ({
        key: f.key, label: f.label, value: f.value, raw_text: f.rawText, confidence: f.confidence, translated: f.translated
      }))
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
    console.error('[translation-docs/client-recognize] unexpected error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
