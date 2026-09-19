const { translateDocumentSegments, StructuralTranslateError } = require('../../lib/translationDocs/structuralTranslate');
const { requirePaidTranslationClient } = require('../../lib/translationAccess');
const { readRequestBody } = require('../../lib/multipart');

// POST /api/translation-docs/structural-translate — режим "Перевести как
// есть" модуля "Перевод" (Ethan, 19 сен 2026): переводит сегменты текста,
// уже извлечённые на клиенте напрямую из word/document.xml загруженного
// .docx (public/js/translation/structuralDocx.mjs), БЕЗ классификации типа
// документа и извлечения полей. Параллельный путь к
// /api/translation-docs/client-recognize — тот же гейт (requirePaidTranslationClient)
// и тот же общий лимит страниц пакета клиента.
//
// Тело: { segments: [{id, text}], clientSlug, language, pageCount } —
// clientSlug и language обязательны, как и у client-recognize.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  try {
    const { segments, clientSlug, language, pageCount } = await readRequestBody(req);
    const slug = await requirePaidTranslationClient(req, clientSlug);
    const result = await translateDocumentSegments({ segments, language, clientSlug: slug, pageCount });
    res.status(200).json({ segments: result.segments });
  } catch (error) {
    if (error instanceof StructuralTranslateError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status !== 500) {
      res.status(status).json({ error: error.message });
      return;
    }
    console.error('[translation-docs/structural-translate] unexpected error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
