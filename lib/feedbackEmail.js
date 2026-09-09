// Обратная связь с сайта (Ethan, 9 сен 2026: "письмо на info@adre-cloud.app
// через Resend, доступно всем, даже на бесплатной версии"). Резервное
// хранение — в api/feedback.js (Supabase, тот же принцип "не терять
// обращение человека, даже если письмо не ушло").

const FEEDBACK_TO = 'info@adre-cloud.app';

// FEEDBACK_FROM_EMAIL — настраивается через Vercel (без передеплоя), т.к.
// Resend отправляет только с доменов, подтверждённых в конкретном аккаунте
// Ethan — угадать это заранее нельзя. Запасной адрес ниже сработает, только
// если домен adre-cloud.app уже подтверждён в его Resend; если нет —
// понадобится либо подтвердить домен, либо задать другой FEEDBACK_FROM_EMAIL.
const DEFAULT_FROM = 'АДРЕ <feedback@adre-cloud.app>';

async function sendFeedbackEmail({ description, comment, pageUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY не настроен на сервере');
  }
  const from = process.env.FEEDBACK_FROM_EMAIL || DEFAULT_FROM;

  const text = [
    'Новое обращение через форму обратной связи АДРЕ.',
    '',
    'Описание:',
    description,
    '',
    comment ? `Комментарий:\n${comment}` : 'Комментарий: (не указан)',
    '',
    pageUrl ? `Страница: ${pageUrl}` : ''
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: FEEDBACK_TO,
      subject: 'Обратная связь — АДРЕ',
      text
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend вернул ${res.status}: ${body}`);
  }
}

module.exports = { sendFeedbackEmail };
