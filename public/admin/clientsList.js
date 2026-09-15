// public/admin/clientsList.js — рендер таблицы клиентов на главном экране
// админки. Вынесено из admin.js 15 сен 2026 (модуляризация по просьбе
// Ethan). onEdit(client) — колбэк на клик «Изменить»: сама форма
// редактирования остаётся в admin.js (там живёт state/editingId), этот
// модуль только рисует список и передаёт наверх, что выбрали.

import { formatUpdatedAt, badgesFor } from './format.js';

export function renderClients(els, clients, onEdit) {
  const { clientsEmpty, clientsTableWrap, clientsBody } = els;
  if (!clients.length) {
    clientsEmpty.style.display = 'block';
    clientsTableWrap.style.display = 'none';
    return;
  }
  clientsEmpty.style.display = 'none';
  clientsTableWrap.style.display = 'block';
  clientsBody.innerHTML = '';

  clients.forEach(client => {
    const tr = document.createElement('tr');

    const idCell = document.createElement('td');
    idCell.className = 'admin-id-cell';
    if (client.api_key) { const d = document.createElement('div'); d.textContent = `API: ${client.api_key}`; idCell.appendChild(d); }
    if (client.client_slug) { const d = document.createElement('div'); d.textContent = `Slug: ${client.client_slug}`; idCell.appendChild(d); }
    tr.appendChild(idCell);

    const labelCell = document.createElement('td');
    labelCell.textContent = client.label || '—';
    tr.appendChild(labelCell);

    const badgesCell = document.createElement('td');
    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'admin-badges';
    const badges = badgesFor(client);
    if (!badges.length) {
      badgeWrap.textContent = '—';
    } else {
      badges.forEach(b => {
        const span = document.createElement('span');
        span.className = 'admin-badge';
        span.textContent = b;
        badgeWrap.appendChild(span);
      });
    }
    badgesCell.appendChild(badgeWrap);
    tr.appendChild(badgesCell);

    const updatedCell = document.createElement('td');
    updatedCell.className = 'admin-updated';
    updatedCell.textContent = formatUpdatedAt(client.updated_at);
    tr.appendChild(updatedCell);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'admin-row-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'admin-link-btn';
    editBtn.textContent = 'Изменить';
    editBtn.addEventListener('click', () => onEdit(client));
    actionsCell.appendChild(editBtn);
    tr.appendChild(actionsCell);

    clientsBody.appendChild(tr);
  });
}
