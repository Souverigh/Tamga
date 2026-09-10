// Троттлинг попыток входа — Ethan, 7 сен 2026, аудит безопасности, пункт 1:
// раньше ни /api/client-auth (пароль клиентского сайта), ни /api/admin/*
// (секрет админки) не ограничивали число попыток вообще — при минимальной
// длине пароля клиента в 4 символа (см. api/admin/clients.js, там же поднята
// до 8) это делало пароль практически подбираемым автоматическими запросами.
//
// ВАЖНО: считаем только НЕУДАЧНЫЕ попытки, не каждый запрос. checkAdminSecret
// (lib/adminAuth.js) вызывается на КАЖДЫЙ запрос к админке — если бы счётчик
// рос от любого вызова (в т.ч. успешного), обычная работа Ethan в собственной
// админке (открыть список клиентов, пару карточек — уже больше 10 запросов)
// сама заблокировала бы его. Поэтому две отдельные Postgres-функции (миграции
// tamga_add_auth_rate_limit + tamga_fix_auth_rate_limit_count_failures_only):
//   isRateLimited  — read-only проверка, вызывается ДО сравнения секрета/
//                    пароля, сама по себе счётчик не трогает.
//   recordFailure  — инкремент, вызывается кодом ТОЛЬКО когда секрет/пароль
//                    оказался неверным.
// Успешный вход и любая легитимная работа никогда не видят счётчик вообще.
//
// Скользящее окно (SELECT ... FOR UPDATE внутри record_auth_failure — тот же
// принцип, что у consume_page_usage/consume_anonymous_page_usage) не
// продлевается заблокированными попытками — иначе атакующий, продолжая
// стучаться, держал бы блокировку вечно.
//
// Fail-OPEN при недоступности Supabase — то же решение, что у остальной
// инфраструктуры учёта в проекте: троттлинг — дополнительный защитный слой
// ПОВЕРХ основной проверки (checkAdminSecret/verifyPassword), а не сама эта
// проверка. Supabase временно недоступен — разумнее вернуться к поведению
// "без троттлинга" (как было до этой фичи), чем заблокировать вход
// легитимному администратору/клиенту из-за постороннего сбоя.
//
// hashIp переиспользован из lib/anonymousUsage.js — тот же несолёный
// SHA-256, что уже отмечен отдельной (более мелкой) находкой аудита: не
// защищает от восстановления IP тем, у кого есть доступ к БД. Для ЭТОЙ
// функции (просто различать разные IP друг от друга ради троттлинга) это не
// критично — чинить будем отдельно, если/когда возьмёмся за тот пункт.

const { hashIp } = require('./anonymousUsage');

async function callRpc(fnName, args) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null; // не настроено — вызывающий код трактует null как "пропустить"

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    if (!res.ok) {
      console.error(`authRateLimit: ${fnName} вернул`, res.status, '— пропускаем без троттлинга');
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (err) {
    console.error(`authRateLimit: ошибка запроса ${fnName}, пропускаем без троттлинга:`, err.message);
    return null;
  }
}

// Возвращает { allowed, retryAfterSeconds } — allowed:false значит "уже
// заблокирован, не пытайтесь проверять секрет/пароль вообще". Не найдя
// Supabase/при сбое — allowed:true (fail-open, см. комментарий выше).
async function isRateLimited(key, { windowSeconds, maxAttempts }) {
  const row = await callRpc('is_rate_limited', { p_key: key, p_window_seconds: windowSeconds, p_max_attempts: maxAttempts });
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: !row.limited, retryAfterSeconds: row.retry_after_seconds || 0 };
}

// Вызывается ТОЛЬКО когда секрет/пароль оказался неверным — см. комментарий
// в начале файла.
async function recordFailure(key, windowSeconds) {
  await callRpc('record_auth_failure', { p_key: key, p_window_seconds: windowSeconds });
}

// Пароль клиентского сайта (/api/client-auth) — ключ по slug И IP вместе:
// ограничивает подбор пароля ОДНОГО конкретного клиента с одного адреса, не
// блокируя того же посетителя от попытки зайти на ДРУГОЙ клиентский сайт
// (например, за общим офисным NAT). slug приводится к нижнему регистру —
// тот же slug с разным регистром не должен считаться отдельным ключом.
const CLIENT_WINDOW_SECONDS = 15 * 60;
const CLIENT_MAX_ATTEMPTS = 5;

function clientAuthKey(clientSlug, ip) {
  return `client:${String(clientSlug).toLowerCase()}:${hashIp(ip || 'unknown')}`;
}

async function checkClientAuthRateLimit({ clientSlug, ip }) {
  return isRateLimited(clientAuthKey(clientSlug, ip), { windowSeconds: CLIENT_WINDOW_SECONDS, maxAttempts: CLIENT_MAX_ATTEMPTS });
}

async function recordClientAuthFailure({ clientSlug, ip }) {
  await recordFailure(clientAuthKey(clientSlug, ip), CLIENT_WINDOW_SECONDS);
}

// Секрет админки (/api/admin/*) — один общий секрет на всю систему (см.
// lib/adminAuth.js), поэтому ключ только по IP, без "аккаунта". Порог выше,
// чем у клиентского пароля (10 вместо 5) — секрет обычно копируют, а не
// печатают руками, но иногда промахиваются буфером обмена/окружением.
const ADMIN_WINDOW_SECONDS = 15 * 60;
const ADMIN_MAX_ATTEMPTS = 10;

function adminAuthKey(ip) {
  return `admin:${hashIp(ip || 'unknown')}`;
}

async function checkAdminRateLimit({ ip }) {
  return isRateLimited(adminAuthKey(ip), { windowSeconds: ADMIN_WINDOW_SECONDS, maxAttempts: ADMIN_MAX_ATTEMPTS });
}

async function recordAdminFailure({ ip }) {
  await recordFailure(adminAuthKey(ip), ADMIN_WINDOW_SECONDS);
}

// Форма обратной связи (/api/feedback, Ethan 9 сен 2026) — другой паттерн от
// входа выше: считаем КАЖДУЮ попытку отправки, а не только неудачные (иначе
// спамер просто продолжал бы "успешно" спамить бесконечно) — отдельная
// Postgres-функция consume_feedback_attempt (миграция tamga_add_feedback,
// таблица tamga_feedback_attempts — намеренно отдельная от tamga_auth_attempts,
// разные по смыслу счётчики). Не переиспользует isRateLimited/recordFailure
// выше (те заточены под ДВА отдельных вызова — read-only проверка + отдельно
// инкремент только-при-неудаче), а сама делает проверку-и-инкремент атомарно
// за один RPC-вызов, тем же приёмом, что и в консольном троттлинге до
// разделения на isRateLimited/recordFailure (см. миграцию
// tamga_fix_auth_rate_limit_count_failures_only — там разделение понадобилось
// ИМЕННО из-за разницы между "каждый запрос" и "только неудачи"; тут наоборот
// нужно считать каждый запрос, старая неразделённая схема как раз подходит).
const FEEDBACK_WINDOW_SECONDS = 60 * 60; // час
const FEEDBACK_MAX_ATTEMPTS = 5;

async function checkFeedbackRateLimit({ ip }) {
  const key = `feedback:${hashIp(ip || 'unknown')}`;
  const row = await callRpc('consume_feedback_attempt', { p_key: key, p_window_seconds: FEEDBACK_WINDOW_SECONDS, p_max_attempts: FEEDBACK_MAX_ATTEMPTS });
  if (!row) return { allowed: true, retryAfterSeconds: 0 }; // fail-open — тот же принцип, что и у остального троттлинга
  return { allowed: !!row.allowed, retryAfterSeconds: row.retry_after_seconds || 0 };
}

module.exports = { checkClientAuthRateLimit, recordClientAuthFailure, checkAdminRateLimit, recordAdminFailure, checkFeedbackRateLimit };
