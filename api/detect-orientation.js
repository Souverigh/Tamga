const { detectOrientation, RecognizeError } = require('../lib/recognize');
const { extractClientIp } = require('../lib/anonymousUsage');
const { readRequestBody } = require('../lib/multipart');

// Дешёвая предварительная проверка поворота страницы ПЕРЕД основным
// распознаванием (см. public/js/ocr/orientation.js) — в отличие от
// /api/recognize НЕ списывает лимит страниц (см. lib/recognize.js:
// detectOrientation): это не распознавание документа, а лишь угол, на
// который клиент повернёт картинку перед единственным платным вызовом.
// Анонимные запросы всё равно ограничены общим троттлингом по IP.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  try {
    const { image, mimeType } = await readRequestBody(req);
    const result = await detectOrientation({ base64: image, mimeType, clientIp: extractClientIp(req) });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof RecognizeError) {
      res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    } else if (err.status) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error('detect-orientation error:', err);
      res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
  }
};
