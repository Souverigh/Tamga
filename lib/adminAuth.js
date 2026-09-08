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
//
// Троттлинг попыток (Ethan, 7 сен 2026, аудит безопасности) — до этой правки
// секрет можно было подбирать неограниченным числом запросов. См.
// lib/authRateLimit.js: до 10 неудачных попыток за 15 минут на IP,
// fail-open при недоступности Supabase. Считаются ТОЛЬКО неудачные попытки
// (checkAdminRateLimit сам по себе счётчик не трогает, recordAdminFailure
// вызывается только при неверном секрете) — иначе обычная работа Ethan в
// собственной админке сама исчерпала бы лимит.
// checkAdminSecret стала асинхронной этой правкой — оба вызывающих места
// (api/admin/clients.js, api/admin/usage.js) обновлены на await.

const { checkAdminRateLimit, recordAdminFailure } = require('./authRateLimit');
const { extractClientIp } = require('./anonymousUsage');

async function checkAdminSecret(req) {
  const expected = process.env.TAMGA_ADMIN_SECRET;
  if (!expected) {
    return { ok: false, status: 500, message: 'Админка не настроена на сервере (нет TAMGA_ADMIN_SECRET)' };
  }

  const ip = extractClientIp(req);
  const rateLimit = await checkAdminRateLimit({ ip });
  if (!rateLimit.allowed) {
    return { ok: false, status: 429, message: 'Слишком много неудачных попыток входа, попробуйте позже' };
  }

  const provided = req.headers['x-admin-secret'];
  if (!provided || provided !== expected) {
    await recordAdminFailure({ ip });
    return { ok: false, status: 401, message: 'Неверный или отсутствующий заголовок x-admin-secret' };
  }
  return { ok: true };
}

module.exports = { checkAdminSecret };
