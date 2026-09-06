// Проверка доступа к админке (/api/admin/*, /admin) — единый секрет в
// переменной окружения TAMGA_ADMIN_SECRET, без учёта пользователей/ролей:
// это внутренний инструмент для одного человека (Ethan), не публичный API.
//
// В отличие от checkApiKey (публичный API, много ключей) здесь один секрет —
// достаточно для единственного администратора. В отличие от customFieldsLookup
// (fail-open — сбой не должен ронять распознавание) здесь fail-CLOSED: если
// TAMGA_ADMIN_SECRET не задан, доступ ко всем admin-эндпоинтам явно закрыт —
// админка даёт запись в Supabase, ошибка "открыто по умолчанию" здесь была бы
// опасной, а не просто неудобной.

function checkAdminSecret(req) {
  const expected = process.env.TAMGA_ADMIN_SECRET;
  if (!expected) {
    return { ok: false, status: 500, message: 'Админка не настроена на сервере (нет TAMGA_ADMIN_SECRET)' };
  }
  const provided = req.headers['x-admin-secret'];
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, message: 'Неверный или отсутствующий заголовок x-admin-secret' };
  }
  return { ok: true };
}

module.exports = { checkAdminSecret };
