const { recognizeDocument, RecognizeError, ALLOWED_MIME_TYPES } = require('../../lib/recognize');
const { checkApiKey } = require('../../lib/apiKeyAuth');

// Публичный API для внешних интеграций (1С, бухгалтерский софт и т.п.).
//
// POST /api/v1/recognize
// Заголовки: x-api-key: <ваш ключ>, Content-Type: application/json
// Тело:      { "image": "<base64>", "mimeType": "image/png", "docType": "Справка" (опционально), "includeText": true (опционально, по умолчанию true), "batchId": "batch_..." (опционально) }
// Ответ:     { "documentType": "...", "text": "...", "fields": [{label, value, confidence}, ...], "items": [], "confidence": 92 }
//            (для табличных типов дополнительно: "columns": [...], "columnKeys": [...] — см. ниже)
//
// "confidence" (на верхнем уровне ответа) — самооценка модели (целое число
// 0-100), насколько она уверена, что текст/поля/строки таблицы извлечены с
// этого изображения полно и верно, В ЦЕЛОМ по документу. Это self-reported
// оценка самой Gemini в том же ответе, а не статистическая вероятность —
// полезный сигнал, чтобы отсортировать пачку и в первую очередь перепроверить
// документы с низким числом, но не гарантия правильности/ошибки. null, если
// модель не смогла дать оценку (см. lib/fieldFormat.js:normalizeConfidence).
//
// "confidence" ВНУТРИ каждого объекта "fields" — та же самооценка, но на
// КОНКРЕТНОЕ значение этого поля, а не на документ целиком: скан может быть
// в целом чётким, но одно имя написано неразборчиво — у него будет низкий
// field-level confidence при высоком document-level. Присутствует только для
// карточных типов (label/value) — товарные строки табличных типов ("items")
// такой оценки на ячейку не несут, только общий "confidence" на весь ответ.
// null по той же причине, что и на уровне документа.
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
// includeText: false — не запрашивать "text" в ответе (вернётся пустой строкой).
// По умолчанию true — если вы не передаёте этот параметр вообще, ничего не
// меняется. Полезно, если вам нужны только структурированные поля ("fields"/
// "items"), не сам текст документа целиком — просить у модели полную
// транскрипцию не бесплатно по времени ответа (генерация текста моделью —
// обычно самая медленная часть ответа для документов с большим объёмом
// текста), а вам эти данные всё равно негде использовать. НЕ влияет на
// расход вашего пакета страниц — страница считается использованной
// одинаково, включаете вы текст в ответ или нет.
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
//
// batchId: необязательный — если вы обрабатываете группу документов и хотите
// получить вебхук "пакет завершён" на свою систему, сначала создайте пакет
// (POST /api/v1/batch), передавайте вернувшийся batchId в каждом вызове
// recognize для этой группы, затем закройте пакет (POST /api/v1/batch с
// { "batchId": "...", "finish": true }) — см. batch.js. Без batchId ничего
// не меняется в поведении этого эндпоинта.
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
    const { image, mimeType, docType, skipOcr, includeText, batchId } = req.body || {};
    const clientApiKey = req.headers['x-api-key'];
    const result = await recognizeDocument({ base64: image, mimeType, docType, skipOcr, includeText, clientApiKey, batchId });
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
