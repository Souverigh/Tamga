// Гейт целого сайта для клиентского пилота (?client=slug) — отдельный механизм
// от lib/adminAuth.js (там один секрет на всю админку) и от checkApiKey (там
// много ключей для бизнес-интеграций). Здесь — один ПАРОЛЬ НА КЛИЕНТА, который
// задаёт Ethan через /admin (см. api/admin/clients.js), а пользователь сайта
// вводит один раз при заходе по ссылке с ?client=slug.
//
// Два примитива:
//   - hashPassword/verifyPassword — пароль в Supabase хранится только хешем
//     (scrypt, встроенный в Node — без внешних зависимостей, как и весь проект).
//   - signToken/verifyToken — после успешного пароля выдаётся подписанный токен
//     (HMAC), который фронтенд хранит в sessionStorage и прикладывает к
//     /api/client-config и /api/recognize (см. эти файлы) — без токена сервер
//     не отдаёт ни фасад, ни распознавание для этого slug.
//
// Клиенты БЕЗ заданного пароля (access_password_hash = null) — гейта нет
// вообще, поведение как раньше (см. lib/customFieldsLookup.js).

const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа — токен живёт в sessionStorage (не переживает закрытие вкладки), это доп. потолок на всякий случай

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload, secret) {
  return base64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

// Токен привязан к КОНКРЕТНОМУ slug — токен для одного клиента не подходит
// для другого, даже если оба защищены паролем (см. verifyToken).
function signToken(clientSlug) {
  const secret = process.env.TAMGA_CLIENT_AUTH_SECRET;
  if (!secret) return null; // не настроено на сервере — см. checkClientGate (fail-closed для защищённых клиентов)
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${clientSlug}:${exp}`;
  const payloadB64 = base64url(Buffer.from(payload));
  return `${payloadB64}.${sign(payload, secret)}`;
}

function verifyToken(token, clientSlug) {
  const secret = process.env.TAMGA_CLIENT_AUTH_SECRET;
  if (!secret || !token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payloadB64, sigB64] = token.split('.');
  let payload;
  try {
    payload = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  } catch (_) {
    return false;
  }
  const expectedSig = sign(payload, secret);
  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  const [slug, expStr] = payload.split(':');
  if (slug !== clientSlug) return false;
  const exp = parseInt(expStr, 10);
  return Number.isFinite(exp) && Date.now() < exp;
}

// Единая точка входа для api/client-config.js и api/recognize.js — оба должны
// применять ОДНО И ТО ЖЕ правило: если у клиента задан пароль, нужен валидный
// токен именно на этот slug, иначе доступ закрыт. passwordHash берётся из
// lib/customFieldsLookup.js:getClientConfig (там же, где остальной конфиг клиента —
// одна и та же строка в Supabase, лишний запрос не нужен).
function checkClientGate({ clientSlug, passwordHash, token }) {
  if (!passwordHash) return { ok: true }; // пароль не задан — гейта нет, как раньше
  if (!process.env.TAMGA_CLIENT_AUTH_SECRET) {
    // Пароль задан, но подписывать/проверять токены нечем — fail-CLOSED:
    // молча пропустить было бы хуже, чем явно сообщить о недонастройке.
    return { ok: false, status: 500, message: 'Доступ к этому клиенту защищён паролем, но сервер не настроен (нет TAMGA_CLIENT_AUTH_SECRET)' };
  }
  if (!verifyToken(token, clientSlug)) {
    return { ok: false, status: 401, message: 'Требуется пароль доступа' };
  }
  return { ok: true };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, checkClientGate };
