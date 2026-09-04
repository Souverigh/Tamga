const { recognizeDocument, RecognizeError, ALLOWED_MIME_TYPES } = require('../../lib/recognize');
const { checkApiKey } = require('../../lib/apiKeyAuth');

// Публичный API для внешних интеграций (1С, бухгалтерский софт и т.п.).
//
// POST /api/v1/recognize
// Заголовки: x-api-key: <ваш ключ>, Content-Type: application/json
// Тело:      { "image": "<base64>", "mimeType": "image/png" }
// Ответ:     { "documentType": "...", "text": "...", "fields": [{label, value}, ...] }
//
// Поддерживаемые mimeType: image/png, image/jpeg, image/webp, application/pdf
// (для application/pdf документ передаётся Gemini напрямую, постраничная
// разбивка на сервере не выполняется — модель обрабатывает файл целиком).
module.exports = async (req, res) => {
  // Разрешаем кросс-доменные вызовы — интеграции обычно идут не из браузера,
  // но не будем этого требовать.
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
    const { image, mimeType } = req.body || {};
    const result = await recognizeDocument({ base64: image, mimeType });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof RecognizeError) {
      res.status(err.status).json({ error: err.message, allowedMimeTypes: ALLOWED_MIME_TYPES });
    } else {
      console.error('v1/recognize error:', err);
      res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
  }
};
