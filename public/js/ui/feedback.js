// Обратная связь (Ethan, 9 сен 2026: "кнопка, если человек туда нажимает —
// открывается форма лёгкая с описанием проблемы (обязательно) и комментарием
// (опционально)... для всех клиентов и даже на бесплатной версии") — не
// зависит от статуса посетителя (клиент/анонимный), кнопка есть всегда,
// см. её разметку в index.html (вне <div id="appRoot"> и вне тех блоков,
// что скрывает/показывает branding.js по slug).

const btn = document.getElementById('feedbackBtn');
const overlay = document.getElementById('feedbackOverlay');
const descriptionInput = document.getElementById('feedbackDescription');
const commentInput = document.getElementById('feedbackComment');
const errorBox = document.getElementById('feedbackError');
const statusBox = document.getElementById('feedbackStatus');
const cancelBtn = document.getElementById('feedbackCancelBtn');
const submitBtn = document.getElementById('feedbackSubmitBtn');

function resetForm() {
  descriptionInput.value = '';
  commentInput.value = '';
  errorBox.style.display = 'none';
  errorBox.textContent = '';
  statusBox.textContent = '';
  submitBtn.disabled = false;
}

function openForm() {
  resetForm();
  overlay.style.display = 'flex';
  descriptionInput.focus();
}

function closeForm() {
  overlay.style.display = 'none';
}

async function submitFeedback() {
  const description = descriptionInput.value.trim();
  if (!description) {
    errorBox.textContent = 'Опишите проблему или вопрос';
    errorBox.style.display = 'block';
    descriptionInput.focus();
    return;
  }
  errorBox.style.display = 'none';
  submitBtn.disabled = true;
  statusBox.textContent = 'Отправляем…';

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, comment: commentInput.value.trim() || undefined })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorBox.textContent = data.error || 'Не удалось отправить, попробуйте ещё раз';
      errorBox.style.display = 'block';
      statusBox.textContent = '';
      submitBtn.disabled = false;
      return;
    }
    statusBox.textContent = data.warning || 'Спасибо! Мы получили ваше сообщение.';
    setTimeout(closeForm, data.warning ? 4000 : 1800);
  } catch (err) {
    errorBox.textContent = 'Не удалось связаться с сервером, попробуйте ещё раз';
    errorBox.style.display = 'block';
    statusBox.textContent = '';
    submitBtn.disabled = false;
  }
}

export function initFeedback() {
  if (!btn || !overlay) return; // страница может не содержать этот блок (например, будущие варианты index.html)
  btn.addEventListener('click', openForm);
  cancelBtn.addEventListener('click', closeForm);
  submitBtn.addEventListener('click', submitFeedback);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeForm(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') closeForm();
  });
}
