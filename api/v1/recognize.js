const { recognizeDocument, RecognizeError, ALLOWED_MIME_TYPES } = require('../../lib/recognize');
const { checkApiKey } = require('../../lib/apiKeyAuth');

// Публичный API для внешних интеграций (1С, бухгалтерский софт и т.п.).
//
// POST /api/v1/recognize
// Заголовки: x-api-key: <ваш ключ>, Content-Type: application/json
// Тело:      { "image": "<base64>", "mimeType": "image/png", "docType": "Справка" (опционально), "skipOcr": false (опционально) }
// Ответ:     { "documentType": "...", "text": "...", "fields": [{label, value}, ...], "items": [] }
//            (для табличных типов дополнительно: "columns": [...], "columnKeys": [...] — см. ниже)
//
// Если docType передан и совпадает с одним из известных типов — классификация
// не выполняется, поля извлекаются сразу под этот тип (короче и точнее запрос).
// Для табличных типов (сейчас — "Накладная / УПД", "Счёт-фактура / Инвойс",
// "Акт выполненных работ", "Справочник номенклатуры") заполняется "items"
// (массив строк по колонкам этого типа), а "fields" остаётся пустым; для
// остальных типов — наоборот. Табличные типы поддерживаются только если
// docType передан явно (см. lib/recognize.js).
//
// "columns"/"columnKeys" в ответе — реально использованная раскладка колонок
// для этого запроса: стандартная (см. DOC_FIELDS в lib/docSchema.js) либо
// кастомная, если для вашего x-api-key настроен field_overrides на этот
// табличный тип (см. ниже) — тогда "columnKeys" будут техническими (col0,
// col1, ...), а "columns" — вашими названиями в том же порядке. Присутствует
// только для табличных типов.
//
// skipOcr: true — не запрашивать "text" в ответе (вернётся пустой строкой).
// Полезно, если text уже получен отдельным запросом (например, для табличного
// типа, если у вас уже есть текст с предыдущего вызова без docType) — экономит
// объём ответа модели.
//
// Кастомный список полей/колонок: если для вашего x-api-key настроена запись
// в таблице tamga_api_key_fields (Supabase, field_overrides) — задаётся вручную
// по запросу, обратитесь к администратору — извлекаются ТОЛЬКО эти поля/колонки
// вместо стандартного набора для docType (при условии что docType передан явно).
// Для карточных типов override — это подписи полей label/value; для табличных —
// названия колонок (см. columns/columnKeys выше).
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
    const { image, mimeType, docType, skipOcr } = req.body || {};
    const clientApiKey = req.headers['x-api-key'];
    const result = await recognizeDocument({ base64: image, mimeType, docType, skipOcr, clientApiKey });
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
