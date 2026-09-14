// Проверка ключа для /api/accounting/* — ОТДЕЛЬНЫЙ список ключей от
// lib/apiKeyAuth.js (TAMGA_API_KEYS). Бухгалтерский модуль — другой продуктовый
// периметр (валидация для бухгалтеров, не распознавание для текущих клиентов
// Tamga) — сознательно не даём тем же ключам доступ сюда без явного решения
// Ethan завести клиента и в этот список тоже.

function getValidKeys() {
  const raw = process.env.ACCOUNTING_API_KEYS || '';
  return raw.split(',').map(k => k.trim()).filter(Boolean);
}

function checkAccountingApiKey(req) {
  const validKeys = getValidKeys();
  if (validKeys.length === 0) {
    return { ok: false, status: 500, message: 'Модуль бухгалтерии не настроен на сервере (нет ACCOUNTING_API_KEYS)' };
  }
  const provided = req.headers['x-api-key'];
  if (!provided || !validKeys.includes(provided)) {
    return { ok: false, status: 401, message: 'Неверный или отсутствующий заголовок x-api-key' };
  }
  return { ok: true, clientRef: provided.slice(0, 8) };
}

module.exports = { checkAccountingApiKey };
