// UI-модуль хода распознавания: панель прогресса, полоса на весь пакет,
// построчный статус страниц, анимация сканирования в дропзоне.
// Не знает, как именно распознаётся текст (Tesseract или Gemini) —
// только отображает состояние, которое ему сообщают.

const dropzone = document.getElementById('dropzone');
const progressPanel = document.getElementById('progressPanel');
const pagesList = document.getElementById('pagesList');
const progressFill = document.getElementById('progressFill');
const cancelProgressBtn = document.getElementById('cancelProgressBtn');
const progressSummaryText = document.getElementById('progressSummaryText');
const hideCompletedCheckbox = document.getElementById('hideCompletedCheckbox');

hideCompletedCheckbox.addEventListener('change', () => {
  pagesList.classList.toggle('hide-done', hideCompletedCheckbox.checked);
});

export function startProgress(onCancel) {
  progressPanel.style.display = 'block';
  cancelProgressBtn.style.display = 'inline-block';
  pagesList.innerHTML = '';
  pagesList.classList.remove('hide-done');
  hideCompletedCheckbox.checked = false;
  progressSummaryText.textContent = '';
  progressFill.style.width = '0%';
  dropzone.classList.add('scanning');
  cancelProgressBtn.onclick = onCancel;
}

// При большом пакете (много файлов/страниц) список из десятков полностью успешных
// файлов только мешает следить за тем, что ещё в процессе или упало с ошибкой —
// включаем скрытие готовых по умолчанию. На малом пакете это не нужно: там же
// самое интересное — увидеть весь результат целиком, ничего не пряча.
export function setDefaultHideCompleted(shouldHide) {
  hideCompletedCheckbox.checked = shouldHide;
  pagesList.classList.toggle('hide-done', shouldHide);
}

export function setProgressSummary(done, errors, total) {
  const remaining = Math.max(0, total - done - errors);
  progressSummaryText.textContent = `Готово: ${done} · Ошибок: ${errors} · Осталось: ${remaining} из ${total}`;
}

export function finishProgress(cancelled) {
  if (!cancelled) progressFill.style.width = '100%';
  cancelProgressBtn.style.display = 'none';
  dropzone.classList.remove('scanning');
}

export function setOverallProgress(fraction) {
  progressFill.style.width = `${Math.round(fraction * 100)}%`;
}

// Создаёт блок «N. имя файла» в списке прогресса, возвращает контейнер для строк страниц.
export function createFileProgressGroup(fileIndex, fileName) {
  const groupTitle = document.createElement('div');
  groupTitle.className = 'file-group-title';
  groupTitle.textContent = `${fileIndex + 1}. ${fileName}`;
  const group = document.createElement('div');
  group.className = 'file-group';
  group.id = `file-group-${fileIndex}`;
  group.appendChild(groupTitle);
  const pagesWrap = document.createElement('div');
  pagesWrap.className = 'pages';
  group.appendChild(pagesWrap);
  pagesList.appendChild(group);
  return pagesWrap;
}

// Файл считается «полностью готовым» (и может быть скрыт при hide-done), только
// если ВСЕ его страницы отмечены done — ни одной ошибки, ни одной ещё в процессе.
function refreshFileGroupDoneState(fileIndex) {
  const group = document.getElementById(`file-group-${fileIndex}`);
  if (!group) return;
  const rows = group.querySelectorAll('.page-row');
  const allDone = rows.length > 0 && Array.from(rows).every(r => r.classList.contains('done'));
  group.classList.toggle('all-done', allDone);
}

// Добавляет построчный список страниц в уже созданный контейнер — вызывается,
// когда количество страниц становится известно (после открытия файла).
export function addPageRows(pagesWrap, fileIndex, pageCount) {
  for (let i = 0; i < pageCount; i++) {
    const row = document.createElement('div');
    row.className = 'page-row';
    row.id = `page-row-${fileIndex}-${i}`;
    row.innerHTML = `<div class="num">${i + 1}</div><div>Страница ${i + 1}</div><div class="status">В очереди</div>`;
    pagesWrap.appendChild(row);
  }
}

export function showFileOpenError(pagesWrap) {
  const errRow = document.createElement('div');
  errRow.className = 'empty';
  errRow.textContent = 'Не удалось открыть файл — пропускаем. Проверьте, что это корректный PDF или изображение.';
  pagesWrap.appendChild(errRow);
}

export function setPageStatus(fileIndex, pageIndex, status) {
  const row = document.getElementById(`page-row-${fileIndex}-${pageIndex}`);
  if (row) row.querySelector('.status').textContent = status;
}

export function markPageDone(fileIndex, pageIndex, status) {
  const row = document.getElementById(`page-row-${fileIndex}-${pageIndex}`);
  if (!row) return;
  row.classList.add('done');
  row.querySelector('.status').textContent = status;
  refreshFileGroupDoneState(fileIndex);
}

export function markPageError(fileIndex, pageIndex, message) {
  const row = document.getElementById(`page-row-${fileIndex}-${pageIndex}`);
  if (!row) return;
  row.querySelector('.status').textContent = 'Ошибка';
  const errLine = document.createElement('div');
  errLine.className = 'empty';
  errLine.style.textAlign = 'left';
  errLine.style.padding = '4px 0 0';
  errLine.textContent = message;
  row.after(errLine);
}
