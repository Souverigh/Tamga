// Замена системным alert()/confirm() — те выглядят чужеродно (особенно на
// мобильном) и не вписываются в стиль интерфейса. showToast — самоисчезающее
// сообщение, showConfirm — модальное окно с выбором, возвращает Promise<boolean>
// (true — пользователь подтвердил основное действие).

let toastTimeout = null;

function ensureToastEl() {
  let el = document.getElementById('appToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'appToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  return el;
}

// type: 'info' | 'error'. Ошибки показываем дольше — их обычно нужно успеть прочитать
// и что-то решить, а не просто заметить мельком, как обычное уведомление.
export function showToast(message, type = 'info') {
  const el = ensureToastEl();
  el.textContent = message;
  el.className = `toast toast-visible${type === 'error' ? ' toast-error' : ''}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.classList.remove('toast-visible'); }, type === 'error' ? 7000 : 3500);
}

export function showConfirm(message, { confirmLabel = 'Продолжить', cancelLabel = 'Отмена' } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-message"></div>
        <div class="btn-row confirm-actions">
          <button class="btn-secondary confirm-no"></button>
          <button class="btn-primary confirm-yes"></button>
        </div>
      </div>
    `;
    overlay.querySelector('.confirm-message').textContent = message;
    overlay.querySelector('.confirm-yes').textContent = confirmLabel;
    overlay.querySelector('.confirm-no').textContent = cancelLabel;

    function close(result) {
      overlay.remove();
      resolve(result);
    }
    overlay.querySelector('.confirm-yes').addEventListener('click', () => close(true));
    overlay.querySelector('.confirm-no').addEventListener('click', () => close(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });

    document.body.appendChild(overlay);
  });
}
