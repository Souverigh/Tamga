const crypto = require('crypto');

// Дневной лимит страниц для анонимного бесплатного сайта (без client_slug/api_key) —
// см. миграцию tamga_anonymous_usage. Отдельно от lib/customFieldsLookup.js:consumeUsage,
// потому что это про совершенно другую сущность (IP посетителя, не настроенный клиент)
// и другую таблицу.
//
// IP никогда не хранится в открытом виде — только SHA-256 хеш, персональные данные
// самих документов сюда не попадают вовсе (это счётчик страниц, не архив).
//
// Fail-open, как и весь остальной проект: сбой Supabase/сети не должен блокировать
// добросовестных посетителей демо-сайта из-за проблем с инфраструктурой учёта —
// это защита от злоупотребления, а не критичная для работы система.

const DEFAULT_DAILY_LIMIT = 20;

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// req — объект запроса Vercel/Node. x-forwarded-for может содержать цепочку
// прокси через запятую — первый адрес в списке это исходный клиент.
// Используется на уровне api/*.js (HTTP-специфика), не внутри lib/recognize.js.
function extractClientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ip — уже извлечённый IP-адрес (см. extractClientIp, вызывается в api/recognize.js).
// Возвращает { allowed, pagesUsed, dailyLimit }. dailyLimit берётся из
// TAMGA_FREE_DAILY_PAGE_LIMIT (сервер), не хранится в БД — это глобальная
// настройка политики, а не атрибут конкретного посетителя.
async function consumeAnonymousUsage(ip) {
  const dailyLimit = Number(process.env.TAMGA_FREE_DAILY_PAGE_LIMIT) || DEFAULT_DAILY_LIMIT;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { allowed: true, pagesUsed: 0, dailyLimit };

  try {
    const ipHash = hashIp(ip || 'unknown');
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_anonymous_page_usage`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_ip_hash: ipHash, p_daily_limit: dailyLimit })
    });
    if (!res.ok) {
      console.error('consumeAnonymousUsage: Supabase RPC вернул', res.status, '— пропускаем без учёта лимита');
      return { allowed: true, pagesUsed: 0, dailyLimit };
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { allowed: !!row.allowed, pagesUsed: row.pages_used, dailyLimit };
  } catch (err) {
    console.error('consumeAnonymousUsage: ошибка запроса к Supabase, пропускаем без учёта лимита:', err.message);
    return { allowed: true, pagesUsed: 0, dailyLimit };
  }
}

module.exports = { consumeAnonymousUsage, extractClientIp, hashIp };
