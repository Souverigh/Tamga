// public/admin/clientUsersList.js — рендер сводной таблицы пользователей
// ВСЕХ клиентов на главном экране админки (Ethan, 21 сен 2026: "видеть всех
// пользователей"). По образцу clientsList.js — сама форма редактирования
// (создание/сброс пароля/роли) остаётся в admin.js, здесь только рисуем
// список и передаём наверх выбранную строку.

import { formatUpdatedAt } from './format.js';

export function renderUsers(els, users, onEdit) {
  const { usersEmpty, usersTableWrap, usersBody } = els;
  if (!users.length) {
    usersEmpty.style.display = 'block';
    usersTableWrap.style.display = 'none';
    return;
  }
  usersEmpty.style.display = 'none';
  usersTableWrap.style.display = 'block';
  usersBody.innerHTML = '';

  users.forEach(user => {
    const tr = document.createElement('tr');

    const clientCell = document.createElement('td');
    clientCell.textContent = user.clientSlug;
    tr.appendChild(clientCell);

    const usernameCell = document.createElement('td');
    usernameCell.textContent = user.username;
    tr.appendChild(usernameCell);

    const roleCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'admin-badge';
    badge.textContent = user.role;
    roleCell.appendChild(badge);
    tr.appendChild(roleCell);

    const nameCell = document.createElement('td');
    nameCell.textContent = user.translatorName || '—';
    tr.appendChild(nameCell);

    const createdCell = document.createElement('td');
    createdCell.className = 'admin-updated';
    createdCell.textContent = formatUpdatedAt(user.createdAt);
    tr.appendChild(createdCell);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'admin-row-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'admin-link-btn';
    editBtn.textContent = 'Изменить';
    editBtn.addEventListener('click', () => onEdit(user));
    actionsCell.appendChild(editBtn);
    tr.appendChild(actionsCell);

    usersBody.appendChild(tr);
  });
}
