// Гейт целого сайта для клиентского пилота (?client=slug) — отдельный механизм
// от lib/adminAuth.js (там один секрет на всю админку) и от checkApiKey (там
// много ключей для бизнес-интеграций).
//
// Перестроено 17 сен 2026 (Ethan: "внутри клиента можно создать пользователей
// с разными ролями, свой логин/пароль") — раньше был ровно один пароль на
// клиента, теперь возможны отдельные пользователи (lib/clientUsers.js,
// таблица tamga_client_users) с ролью 'owner' или 'translator'. Пока клиент
// не завёл НИ ОДНОГО пользователя — всё работает как раньше, один общий
// пароль (access_password_hash на клиенте, задаёт Ethan через /admin или сам
// владелец через смену пароля). Как только появляется хотя бы один
// пользователь — вход требует логин+пароль именно этого человека.
//
// Три примитива:
//   - hashPassword/verifyPassword — пароль в Supabase хранится только хешем
//     (scrypt, встроенный в Node — без внешних зависимостей, как и весь проект).
//   - signToken/verifyToken — после успешного пароля выдаётся подписанный токен
//     (HMAC), который фронтенд хранит в sessionStorage и прикладывает к
//     /api/client-config и /api/recognize (см. эти файлы) — без токена сервер
//     не отдаёт ни фасад, ни распознавание для этого slug.
//   - checkClientGate/requireClientSettingsAuth — асинхронные (резолвят
//     personal identity через lib/clientUsers.js, если у клиента есть
//     пользователи), возвращают {ok, username, role, translatorName}, а не
//     только {ok} — роль/ФИО всегда берутся СВЕЖИМИ из БД по токену, а не
//     из самого токена, чтобы смена роли/пароля применялась сразу, а не
//     ждала истечения уже выданного 24-часового токена.
//
// Клиенты БЕЗ заданного пароля И без пользователей — гейта нет вообще,
// поведение как раньше (см. lib/customFieldsLookup.js).

const crypto = require('crypto');
const { hasClientUsers, getClientUser } = require('./clientUsers');

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

// Токен привязан к КОНКРЕТНОМУ slug (и, если задан, username) — не подходит
// ни для другого клиента, ни для другого пользователя того же клиента, даже
// если оба защищены паролем (см. verifyToken). username — '' для легаси-входа
// по общему паролю клиента (без отдельных пользователей); допустимый набор
// символов ограничен при создании пользователя (см. api/client-users.js),
// поэтому простое ':' как разделитель безопасно — конфликтов не будет.
function signToken(clientSlug, passwordHash, username = '') {
  const master = process.env.TAMGA_CLIENT_AUTH_SECRET;
  const secret = master && passwordHash ? sign(passwordHash, master) : null;
  if (!secret) return null; // не настроено на сервере — см. checkClientGate (fail-closed для защищённых клиентов)
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${clientSlug}:${username}:${exp}`;
  const payloadB64 = base64url(Buffer.from(payload));
  return `${payloadB64}.${sign(payload, secret)}`;
}

// Разбирает payload токена БЕЗ проверки подписи — только чтобы узнать,
// какой пароль-хеш подбирать для реальной криптографической проверки (см.
// resolveIdentity ниже). Сам по себе НИКОГДА не доказывает подлинность —
// используется исключительно как подсказка "что проверять", а не как ответ.
function decodeTokenPayload(token) {
  if (!token || typeof token !== 'string' || !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]{43}$/.test(token)) return null;
  const [payloadB64] = token.split('.');
  try {
    const payload = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const [clientSlug, username, expStr] = payload.split(':');
    const exp = parseInt(expStr, 10);
    if (!clientSlug || !Number.isFinite(exp)) return null;
    return { clientSlug, username: username || '', exp, raw: payload };
  } catch (_) {
    return null;
  }
}

function verifyToken(token, clientSlug, passwordHash) {
  const master = process.env.TAMGA_CLIENT_AUTH_SECRET;
  const secret = master && passwordHash ? sign(passwordHash, master) : null;
  if (!secret || !token || typeof token !== 'string' || !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]{43}$/.test(token)) return false;
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

  const [slug, , expStr] = payload.split(':');
  if (slug !== clientSlug) return false;
  const exp = parseInt(expStr, 10);
  return Number.isFinite(exp) && Date.now() < exp;
}

// Резолвит токен в личность: {username, role, translatorName} — или null,
// если токен не проходит проверку (истёк, подделан, ссылается на удалённого
// пользователя/сменённый пароль). username==='' в токене — легаси-путь без
// отдельных пользователей, personhood — сам клиент, роль всегда 'owner'
// (ровно старое поведение, ничего не меняется для клиентов без пользователей).
async function resolveIdentity({ clientSlug, token, fallbackPasswordHash }) {
  const decoded = decodeTokenPayload(token);
  if (!decoded || decoded.clientSlug !== clientSlug) return null;

  let passwordHash, role, username, translatorName;
  if (decoded.username) {
    const user = await getClientUser(clientSlug, decoded.username);
    if (!user) return null; // пользователь удалён/переименован с момента выдачи токена
    passwordHash = user.password_hash;
    role = user.role;
    username = user.username;
    translatorName = user.translator_name || null;
  } else {
    passwordHash = fallbackPasswordHash;
    role = 'owner';
    username = '';
    translatorName = null;
  }
  if (!passwordHash || !verifyToken(token, clientSlug, passwordHash)) return null;
  return { username, role, translatorName };
}

// Единая точка входа для api/client-config.js, api/recognize.js и т.п. —
// применяют ОДНО И ТО ЖЕ правило: если у клиента задан пароль ИЛИ есть хотя
// бы один пользователь, нужна валидная личность именно на этот slug, иначе
// доступ закрыт. passwordHash (легаси, общий пароль клиента) берётся из
// lib/customFieldsLookup.js:getClientConfig — та же строка, что остальной
// конфиг клиента, лишний запрос не нужен.
async function checkClientGate({ clientSlug, passwordHash, token }) {
  const usersExist = await hasClientUsers(clientSlug);
  if (!passwordHash && !usersExist) return { ok: true }; // ни пароля, ни пользователей — гейта нет, как раньше
  if (!process.env.TAMGA_CLIENT_AUTH_SECRET) {
    // Гейт нужен, но подписывать/проверять токены нечем — fail-CLOSED:
    // молча пропустить было бы хуже, чем явно сообщить о недонастройке.
    return { ok: false, status: 500, message: 'Доступ к этому клиенту защищён паролем, но сервер не настроен (нет TAMGA_CLIENT_AUTH_SECRET)' };
  }
  const identity = await resolveIdentity({ clientSlug, token, fallbackPasswordHash: passwordHash });
  // usernameRequired — чтобы фронтенд (branding.js) сразу показал оба поля
  // клиентам с отдельными пользователями, без лишнего круга "ввели пароль →
  // получили USERNAME_REQUIRED → ввели ещё и логин" (Ethan, 21 сен 2026:
  // "2 шага для логина это много").
  if (!identity) return { ok: false, status: 401, message: 'Требуется пароль доступа', usernameRequired: usersExist };
  return { ok: true, ...identity };
}

// Гейт для самообслуживания клиента (api/client-settings.js/api/client-users.js,
// Ethan, 8 сен 2026: "чтобы клиенты сами меняли поля/типы/бизнес-правила") —
// СТРОЖЕ, чем checkClientGate выше: это ЗАПИСЬ в конфигурацию клиента, а не
// чтение — отсутствие пароля не должно означать "открыто для всех". Роль НЕ
// проверяется здесь — это делает вызывающий код (api/client-settings.js
// требует role==='owner' для собственно настроек; lib/translationAccess.js/
// lib/accounting/clientAccess.js переиспользуют этот же строгий "всегда
// нужен валидный логин" гейт для платных инструментов, доступных ОБЕИМ
// ролям, поэтому проверка роли здесь была бы неверной для них).
async function requireClientSettingsAuth({ clientSlug, passwordHash, token }) {
  const usersExist = await hasClientUsers(clientSlug);
  if (!passwordHash && !usersExist) {
    return { ok: false, status: 403, message: 'Настройки доступны только после того, как для сайта задан пароль — обратитесь к администратору.' };
  }
  if (!process.env.TAMGA_CLIENT_AUTH_SECRET) {
    return { ok: false, status: 500, message: 'Сервер не настроен (нет TAMGA_CLIENT_AUTH_SECRET)' };
  }
  const identity = await resolveIdentity({ clientSlug, token, fallbackPasswordHash: passwordHash });
  if (!identity) return { ok: false, status: 401, message: 'Требуется пароль доступа' };
  return { ok: true, ...identity };
}

async function refreshClientToken({ clientSlug, passwordHash, token }) {
  if (!clientSlug || !token) return null;
  const identity = await resolveIdentity({ clientSlug, token, fallbackPasswordHash: passwordHash });
  if (!identity) return null;
  let passwordHashForToken = passwordHash;
  if (identity.username) {
    const user = await getClientUser(clientSlug, identity.username);
    passwordHashForToken = user?.password_hash;
  }
  return passwordHashForToken
    ? signToken(clientSlug, passwordHashForToken, identity.username)
    : null;
}

module.exports = {
  hashPassword, verifyPassword, signToken, verifyToken, decodeTokenPayload,
  checkClientGate, requireClientSettingsAuth, refreshClientToken
};
