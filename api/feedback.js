const { extractClientIp, hashIp } = require('../lib/anonymousUsage');
const { checkFeedbackRateLimit } = require('../lib/authRateLimit');
const { sendFeedbackEmail } = require('../lib/feedbackEmail');

const MAX_LENGTH = 5000; // с запасом на длинное описание, но не безлимитно

// POST /api/feedback — форма обратной связи (Ethan, 9 сен 2026: "доступна
// всем, даже на бесплатной версии" — без x-api-key/x-client-token, никакой
// авторизации не требует вообще, любой посетитель сайта).
//
// Резервное хранение в Supabase ВСЕГДА (даже если письмо ушло успешно) —
// если Resend когда-нибудь подведёт, обращение не потеряется бесследно.
// Хранение выполняется НАПРЯМУЮ (не через lib/customFieldsLookup.js — та
// заточена под конфиг клиента, тут другая таблица и другая задача).
async function storeFeedback({ description, comment, ipHash, pageUrl, emailSent, emailError }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return; // не настроено — тихо пропускаем, письмо всё равно попытается уйти

  try {
    await fetch(`${supabaseUrl}/rest/v1/tamga_feedback`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, comment: comment || null, ip_hash: ipHash, page_url: pageUrl || null, email_sent: emailSent, email_error: emailError || null })
    });
  } catch (err) {
    console.error('feedback: не удалось сохранить резервную копию в Supabase:', err.message);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается, используйте POST' });
    return;
  }

  const { description, comment } = req.body || {};
  if (!description || typeof description !== 'string' || !description.trim()) {
    res.status(400).json({ error: 'Опишите проблему или вопрос' });
    return;
  }
  if (description.length > MAX_LENGTH) {
    res.status(400).json({ error: `Описание слишком длинное (максимум ${MAX_LENGTH} символов)` });
    return;
  }
  if (comment !== undefined && comment !== null && comment !== '') {
    if (typeof comment !== 'string' || comment.length > MAX_LENGTH) {
      res.status(400).json({ error: `Комментарий слишком длинный (максимум ${MAX_LENGTH} символов)` });
      return;
    }
  }

  const ip = extractClientIp(req);
  const rateLimit = await checkFeedbackRateLimit({ ip });
  if (!rateLimit.allowed) {
    res.status(429).json({ error: 'Слишком много обращений с вашего адреса, попробуйте позже' });
    return;
  }

  const trimmedDescription = description.trim();
  const trimmedComment = comment ? comment.trim() : null;
  const pageUrl = req.headers.referer || req.headers.referrer || null;

  let emailSent = false;
  let emailError = null;
  try {
    await sendFeedbackEmail({ description: trimmedDescription, comment: trimmedComment, pageUrl });
    emailSent = true;
  } catch (err) {
    emailError = err.message;
    console.error('feedback: не удалось отправить письмо:', err.message);
  }

  await storeFeedback({
    description: trimmedDescription, comment: trimmedComment,
    ipHash: hashIp(ip), pageUrl, emailSent, emailError
  });

  if (!emailSent) {
    // Обращение всё равно сохранено (если Supabase настроен) — не теряем
    // его полностью, но честно предупреждаем: письмо могло не дойти.
    res.status(200).json({ ok: true, warning: 'Сообщение принято, но отправка письма не удалась — мы его сохранили и разберёмся отдельно.' });
    return;
  }
  res.status(200).json({ ok: true });
};
