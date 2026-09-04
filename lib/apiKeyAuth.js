// Простая проверка ключа для публичного API (/api/v1/*).
//
// Сейчас ключи — это просто список в переменной окружения TAMGA_API_KEYS
// (через запятую), без учёта пользователей и лимитов — это осознанно
// отложено. Когда понадобятся аккаунты/лимиты/биллинг на интеграции,
// эта функция — единственное место, которое нужно заменить на запрос
// в Supabase (таблица api_keys: key, client_name, requests_count, ...).
// Остальной код endpoint'ов трогать не придётся.

function getValidKeys() {
  const raw = process.env.TAMGA_API_KEYS || '';
  return raw.split(',').map(k => k.trim()).filter(Boolean);
}

function checkApiKey(req) {
  const validKeys = getValidKeys();
  if (validKeys.length === 0) {
    // Публичный API ещё не настроен — явно и безопасно отказываем, а не пропускаем всех.
    return { ok: false, status: 500, message: 'Публичный API не настроен на сервере (нет TAMGA_API_KEYS)' };
  }
  const provided = req.headers['x-api-key'];
  if (!provided || !validKeys.includes(provided)) {
    return { ok: false, status: 401, message: 'Неверный или отсутствующий заголовок x-api-key' };
  }
  return { ok: true };
}

module.exports = { checkApiKey };
