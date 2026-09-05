const { recognizeDocument, RecognizeError } = require('../lib/recognize');

// Эндпоинт для веб-интерфейса Тамги (public/index.html).
// Ключа не требует — вызывается тем же сайтом. Ключ Gemini живёт только
// в переменной окружения GEMINI_API_KEY на сервере, в браузер не попадает.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  try {
    const { image, mimeType, docType, skipOcr } = req.body || {};
    const result = await recognizeDocument({ base64: image, mimeType, docType, skipOcr });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof RecognizeError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error('recognize error:', err);
      res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
  }
};
