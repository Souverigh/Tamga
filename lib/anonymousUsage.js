const crypto = require('crypto');

// Дневной лимит страниц для анонимного бесплатного сайта (без client_slug/api_key) —
// см. миграцию tamga_anonymous_usage. Отдельно от lib/customFieldsLookup.js:consumeUsage,
// потому что это про совершенно другую сущность (IP посетителя, не настроенный клиент)
// и другую таблицу.
//
// IP никогда не хранится в открытом виде — только SHA-256 хеш, персональные данные
// самих документов сюда не попадают вовсе (это счётчик страниц, не архив).
//
// Если учёт недоступен, запрос отклоняется: сбой не открывает бесплатный безлимит.

// Ethan, 8 сен 2026: снижено с 20 до 3 страниц в день — бесплатный тариф
// должен быть демонстрационным ("Пробный", см. тарифы на сайте-визитке), не
// полноценной бесплатной заменой платного пакета. Лимит фиксирован для всех.
const DEFAULT_DAILY_LIMIT = 3;

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
// Возвращает { allowed, pagesUsed, dailyLimit }.
async function consumeAnonymousUsage(ip) {
  const dailyLimit = DEFAULT_DAILY_LIMIT;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Free quota storage is not configured');

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
      throw new Error(`Free quota storage returned ${res.status}`);
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { allowed: !!row.allowed, pagesUsed: row.pages_used, dailyLimit };
  } catch (err) {
    console.error('consumeAnonymousUsage: учёт недоступен:', err.message);
    throw err;
  }
}

module.exports = { consumeAnonymousUsage, extractClientIp, hashIp };
