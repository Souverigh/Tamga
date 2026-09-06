const { recognizeDocument, RecognizeError } = require('../lib/recognize');
const { getClientConfig } = require('../lib/customFieldsLookup');
const { checkClientGate } = require('../lib/clientAuth');
const { extractClientIp } = require('../lib/anonymousUsage');

// Эндпоинт для веб-интерфейса Тамги (public/index.html).
// Ключа не требует — вызывается тем же сайтом. Ключ Gemini живёт только
// в переменной окружения GEMINI_API_KEY на сервере, в браузер не попадает.
//
// clientSlug — необязательный идентификатор клиентского пилота (?client=slug
// в URL, см. public/js/branding.js) — по нему recognizeDocument находит конфиг
// клиента в Supabase (кастомные поля/типы документов/форматирование). Без него
// поведение не меняется — обычный посетитель сайта его никогда не передаёт.
//
// Если у clientSlug задан пароль доступа к сайту (см. lib/clientAuth.js,
// /admin) — нужен валидный заголовок x-client-token НА ЭТОТ ЖЕ slug, иначе
// 401. Без этой проверки здесь гейт на самой странице (branding.js) можно было
// бы обойти, вызвав этот эндпоинт напрямую с чужим slug в теле запроса —
// сайт бы не открылся, но распознавание под чужим клиентским конфигом всё
// равно бы работало.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  try {
    const { image, mimeType, docType, skipOcr, clientSlug } = req.body || {};

    if (clientSlug) {
      // Отдельный запрос конфига здесь (recognizeDocument внутри лезет за ним ещё
      // раз) — сознательный компромисс: держим проверку гейта на уровне API,
      // а не внутри бизнес-логики recognizeDocument (которая не должна знать
      // про пароли/токены). Лишний запрос к Supabase дешёвый и происходит
      // только для clientSlug-запросов, не для обычных посетителей сайта.
      const config = await getClientConfig({ clientSlug });
      const gate = checkClientGate({ clientSlug, passwordHash: config ? config.passwordHash : null, token: req.headers['x-client-token'] });
      if (!gate.ok) {
        res.status(gate.status).json({ error: gate.message });
        return;
      }
    }

    const result = await recognizeDocument({
      base64: image,
      mimeType,
      docType,
      skipOcr,
      clientSlug,
      // clientIp — только для анонимных запросов (без clientSlug): дневной
      // лимит бесплатного сайта (см. lib/anonymousUsage.js). Для настроенных
      // клиентов не нужен — у них свой лимит по разовому пакету (page_limit).
      clientIp: clientSlug ? undefined : extractClientIp(req)
    });
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
