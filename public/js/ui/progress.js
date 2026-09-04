// UI-модуль хода распознавания: панель прогресса, полоса на весь пакет,
// построчный статус страниц, анимация сканирования в дропзоне.
// Не знает, как именно распознаётся текст (Tesseract или Gemini) —
// только отображает состояние, которое ему сообщают.

const dropzone = document.getElementById('dropzone');
const progressPanel = document.getElementById('progressPanel');
const pagesList = document.getElementById('pagesList');
const progressFill = document.getElementById('progressFill');
const cancelProgressBtn = document.getElementById('cancelProgressBtn');

export function startProgress(onCancel) {
  progressPanel.style.display = 'block';
  cancelProgressBtn.style.display = 'inline-block';
  pagesList.innerHTML = '';
  progressFill.style.width = '0%';
  dropzone.classList.add('scanning');
  cancelProgressBtn.onclick = onCancel;
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
  group.appendChild(groupTitle);
  const pagesWrap = document.createElement('div');
  pagesWrap.className = 'pages';
  group.appendChild(pagesWrap);
  pagesList.appendChild(group);
  return pagesWrap;
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
