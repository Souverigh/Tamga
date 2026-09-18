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
    const { image, mimeType, sourceText, clientSlug, language, pageCount } = await readRequestBody(req);
    const slug = await requirePaidTranslationClient(req, clientSlug);
    const apiKey = process.env.GEMINI_API_KEY;

    const recognition = await recognizeAndTranslateDocument({ base64: image, mimeType, sourceText, apiKey, language, clientSlug: slug, pageCount });

    res.status(200).json({
      doc_type: recognition.docType,
      language: recognition.language,
      sourceLanguage: recognition.sourceLanguage,
      structure: recognition.structure,
      quality: recognition.quality,
      regulation: recognition.regulation,
      fields: recognition.fields.map(f => ({
        key: f.key,
        label: f.label,
        targetLabel: f.targetLabel,
        value: f.value,
        raw_text: f.rawText,
        confidence: f.confidence,
        translated: f.translated,
        translationStatus: f.translationStatus,
        requiresReview: f.requiresReview, reviewReason: f.reviewReason, verificationCandidate: f.verificationCandidate
      })),
      paragraphs: Array.isArray(recognition.paragraphs)
        ? recognition.paragraphs.map(paragraph => ({ text: paragraph.text, translated: paragraph.translated }))
        : [],
      tables: Array.isArray(recognition.tables)
        ? recognition.tables.map(table => ({
          section: table.section,
          rows: table.rows.map(row => ({
            subject: row.subject,
            grade: row.grade,
            translatedSubject: row.translatedSubject,
            translatedGrade: row.translatedGrade,
            confidence: row.confidence
          }))
        }))
        : [],
      ...(Array.isArray(recognition.elements) ? {
        elements: recognition.elements.map(element => ({
          key: element.key,
          type: element.elementType,
          number: element.number || null,
          label: element.label,
          targetLabel: element.targetLabel,
          value: element.value,
          translated: element.translated,
          raw_text: element.rawText,
          confidence: element.confidence,
          requiresReview: element.requiresReview, reviewReason: element.reviewReason
        }))
      } : {})
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
