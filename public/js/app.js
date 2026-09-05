// Точка входа приложения. Сама не содержит бизнес-логики распознавания,
// классификации или извлечения — только вызывает независимые модули
// в нужном порядке и передаёт данные между ними.

import { classifyByKeywords } from './classification/keywordClassifier.js';
import { extractFieldsHeuristic } from './extraction/heuristicExtractor.js';
import { postProcessText } from './postprocess/textCleanup.js';
import { loadPdfPages } from './ocr/pdfLoader.js';
import { loadImageFile } from './ocr/imageLoader.js';
import { recognizeWithTesseract, cancelTesseract } from './ocr/tesseractClient.js';
import { recognizeWithGemini } from './api/geminiRecognizeClient.js';
import { saveResultsToStorage, loadSavedResults, clearSavedResults } from './storage/resultsStorage.js';
import { downloadTxt, buildAllText } from './export/txtExport.js';
import { downloadXlsx } from './export/xlsxExport.js';
import { downloadPdf } from './export/pdfExport.js';
import { initFileList, getSelectedFiles, getSelectedDocTypes, setControlsDisabled } from './ui/fileList.js';
import {
  startProgress, finishProgress, setOverallProgress,
  createFileProgressGroup, addPageRows, showFileOpenError, setPageStatus, markPageDone, markPageError
} from './ui/progress.js';
import { showResults, hideResults, initResultsCollapseToggle, getFileGroups } from './ui/results.js';
import { initSettings, getSelectedMode, getSelectedLang } from './ui/settings.js';
import { isTableType, DOC_TYPES } from './config/docSchema.js';

const recognizeBtn = document.getElementById('recognizeBtn');
const langSelect = document.getElementById('langSelect');
const modeSelect = document.getElementById('modeSelect');
const postProcessCheckbox = document.getElementById('postProcessCheckbox');
const restoreBanner = document.getElementById('restoreBanner');
const restoreBtn = document.getElementById('restoreBtn');
const dismissRestoreBtn = document.getElementById('dismissRestoreBtn');
const copyAllBtn = document.getElementById('copyAllBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadXlsxBtn = document.getElementById('downloadXlsxBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');

// --- Загрузка файлов: при любом изменении списка прячем прогресс и старые результаты ---
initFileList({
  onChange: () => {
    document.getElementById('progressPanel').style.display = 'none';
    document.getElementById('pagesList').innerHTML = '';
    hideResults();
  }
});

initSettings();
initResultsCollapseToggle();

// --- Восстановление результатов с прошлого визита ---
const savedResults = loadSavedResults();
if (savedResults) restoreBanner.style.display = 'block';

restoreBtn.addEventListener('click', () => {
  const results = loadSavedResults();
  if (results) {
    showResults(results);
  } else {
    alert('Не удалось восстановить результаты — данные повреждены.');
  }
  restoreBanner.style.display = 'none';
});

dismissRestoreBtn.addEventListener('click', () => {
  clearSavedResults();
  restoreBanner.style.display = 'none';
});

// --- Основной сценарий: файл → страницы → (OCR + классификация? + извлечение) → результат ---

function lockControls() {
  recognizeBtn.disabled = true;
  setControlsDisabled(true);
  langSelect.querySelectorAll('input').forEach(el => el.disabled = true);
  modeSelect.querySelectorAll('input').forEach(el => el.disabled = true);
  postProcessCheckbox.disabled = true;
}

function unlockControls() {
  recognizeBtn.disabled = false;
  setControlsDisabled(false);
  langSelect.querySelectorAll('input').forEach(el => el.disabled = false);
  modeSelect.querySelectorAll('input').forEach(el => el.disabled = false);
  postProcessCheckbox.disabled = false;
}

async function loadPageImages(file) {
  return file.type === 'application/pdf' ? loadPdfPages(file) : loadImageFile(file);
}

// Распознаёт одну страницу выбранным движком. Возвращает { rawText, docType, fields, items }.
// docType/fields/items заполняются только Gemini-режимом (Tesseract их не знает — см. классификацию ниже).
//
// Авто-извлечение таблиц без ручного выбора типа: если тип не был известен заранее
// (пользователь оставил «Определить автоматически»), первый запрос не мог попросить
// у Gemini построчные items — до классификации сервер ещё не знает, какие колонки
// нужны (см. lib/recognize.js). Если результат классификации оказался табличным типом
// (накладная, справочник номенклатуры и т.д.) — делаем второй запрос уже с известным
// типом. Это тот же путь, что при ручном выборе типа в списке файлов, просто выбор
// происходит не пользователем, а по результату первого запроса. Каждый запрос — это
// отдельный вызов serverless-функции со своим лимитом в 60 сек, так что риск 504
// не удваивается на одном запросе. Второй запрос делаем только для табличных типов —
// на обычных документах (паспорт, справка и т.д.) поведение не меняется.
async function recognizePage(pageImage, mode, lang, presetType, onTesseractProgress, onStage) {
  if (mode === 'gemini') {
    const result = await recognizeWithGemini(pageImage, presetType);
    const needsTableFollowUp = !presetType && isTableType(result.docType) && (!result.items || result.items.length === 0);
    if (needsTableFollowUp) {
      if (onStage) onStage();
      try {
        // skipOcr: true — text уже есть от первого запроса (result.text), повторно
        // просить у Gemini полную OCR-расшифровку в этом запросе незачем: это
        // чистая избыточность, раздувающая объём ответа без пользы (см. лог рефакторинга).
        const tableResult = await recognizeWithGemini(pageImage, result.docType, { skipOcr: true });
        return { rawText: result.text, docType: result.docType, fields: result.fields, items: tableResult.items };
      } catch (e) {
        // Второй запрос не удался (например, 504) — не роняем страницу целиком: текст
        // и определённый тип у нас уже есть, таблица просто останется пустой для
        // ручного заполнения, как раньше при ручном выборе табличного типа.
        console.error('Авто-извлечение таблицы не удалось, оставляем текст и тип без строк:', e);
        return { rawText: result.text, docType: result.docType, fields: result.fields, items: null };
      }
    }
    return { rawText: result.text, docType: result.docType, fields: result.fields, items: result.items };
  }
  const rawText = await recognizeWithTesseract(pageImage, lang, onTesseractProgress);
  return { rawText, docType: null, fields: null, items: null };
}

async function recognizeFile(file, fileIndex, totalFiles, mode, lang, presetType) {
  const pagesWrap = createFileProgressGroup(fileIndex, file.name);

  let pageImages;
  try {
    pageImages = await loadPageImages(file);
  } catch (e) {
    showFileOpenError(pagesWrap);
    return null;
  }

  addPageRows(pagesWrap, fileIndex, pageImages.length);

  const pageTexts = [];
  let fileDocType = presetType; // если пользователь выбрал тип заранее — классификация не запускается вообще
  let fileFields = null;
  let fileItems = null;

  for (let i = 0; i < pageImages.length; i++) {
    setPageStatus(fileIndex, i, 'Распознаём…');
    recognizeBtn.textContent = `Файл ${fileIndex + 1} из ${totalFiles}, страница ${i + 1} из ${pageImages.length}…`;

    try {
      const { rawText, docType, fields, items } = await recognizePage(pageImages[i], mode, lang, presetType, m => {
        const pct = Math.round(m.progress * 100);
        const stage = (m.status.includes('loading') || m.status.includes('load')) ? 'Загружаем движок' : 'Распознаём';
        recognizeBtn.textContent = `${stage}… файл ${fileIndex + 1}/${totalFiles}, стр. ${i + 1}/${pageImages.length} — ${pct}%`;
      }, () => {
        recognizeBtn.textContent = `Извлекаем таблицу… файл ${fileIndex + 1}/${totalFiles}, стр. ${i + 1}/${pageImages.length}`;
      });

      // Тип уже задан пользователем — не даём Gemini-классификации его переопределить.
      if (!presetType && fileDocType === null && docType) fileDocType = docType;
      // Поля/товарные строки от Gemini берём в любом случае (даже если тип задан вручную):
      // бэкенд теперь извлекает их именно под этот тип (см. lib/extraction.js), так что они
      // надёжнее локальной regex-эвристики ниже, которая остаётся только запасным вариантом
      // (и для табличных типов вообще недоступна — см. heuristicExtractor.js).
      if (fileFields === null && fields) fileFields = fields;
      if (fileItems === null && items) fileItems = items;

      pageTexts.push(postProcessText(rawText, { cleanup: true, normalize: postProcessCheckbox.checked }));
      markPageDone(fileIndex, i, 'Готово');
    } catch (e) {
      pageTexts.push('');
      markPageError(fileIndex, i, e && e.message ? e.message : String(e));
    }

    setOverallProgress((fileIndex + (i + 1) / pageImages.length) / totalFiles);
  }

  // Классификация и извлечение полей не должны молча ронять весь сценарий: если
  // здесь что-то пойдёт не так (например, неожиданный формат от Gemini или
  // classifyByKeywords), файл всё равно попадёт в результаты с распознанным
  // текстом и типом «Другое» — лучше так, чем зависшая кнопка и пустой экран.
  let fields = [];
  let items = [];
  try {
    // Классификация (независимый модуль) — только если тип не был известен заранее и не пришёл от Gemini.
    if (!presetType && !fileDocType && mode === 'tesseract') {
      fileDocType = classifyByKeywords(pageTexts.join('\n'));
    }
    if (!fileDocType || !DOC_TYPES.includes(fileDocType)) fileDocType = 'Другое';

    // Извлечение полей (независимый модуль) — только если Gemini их ещё не вернул в этом же запросе.
    const joinedText = pageTexts.join('\n');
    fields = isTableType(fileDocType) ? [] : (fileFields || extractFieldsHeuristic(joinedText, fileDocType));
    // Товарные строки: офлайн-эвристика их не производит (см. heuristicExtractor.js) —
    // без Gemini таблица придёт пустой, пользователь заполнит вручную в интерфейсе.
    items = fileItems || [];
  } catch (e) {
    console.error('Классификация/извлечение полей упали, файл всё равно вернём с текстом:', e);
    fileDocType = DOC_TYPES.includes(fileDocType) ? fileDocType : 'Другое';
  }

  return { fileName: file.name, pages: pageTexts, docType: fileDocType, fields, items };
}

recognizeBtn.addEventListener('click', async () => {
  const selectedFiles = getSelectedFiles();
  const selectedDocTypes = getSelectedDocTypes();
  if (selectedFiles.length === 0) return;

  const mode = getSelectedMode();
  const lang = getSelectedLang();

  // Офлайн-режим (Tesseract) не умеет строить таблицу построчно ни для одного
  // табличного типа (см. heuristicExtractor.js) — предупреждаем, а не тихо
  // отдаём пустую таблицу.
  const selectedTableTypes = selectedDocTypes.filter(t => isTableType(t));
  if (mode === 'tesseract' && selectedTableTypes.length > 0) {
    const typesList = selectedTableTypes.map(t => `«${t}»`).join(', ');
    const proceed = confirm(
      `Для типа(ов) ${typesList} офлайн-режим (Tesseract) не распознаёт строки таблицы — таблицу придётся заполнять вручную.\n\n` +
      'Рекомендуем переключиться на режим Gemini. Продолжить в офлайн-режиме?'
    );
    if (!proceed) return;
  }

  restoreBanner.style.display = 'none';
  let cancelled = false;

  lockControls();
  hideResults();
  startProgress(() => { cancelled = true; cancelTesseract(); });

  const fileResults = [];
  try {
    for (let f = 0; f < selectedFiles.length; f++) {
      if (cancelled) break;
      const presetType = selectedDocTypes[f] && selectedDocTypes[f] !== 'auto' ? selectedDocTypes[f] : null;
      const result = await recognizeFile(selectedFiles[f], f, selectedFiles.length, mode, lang, presetType);
      if (result) fileResults.push(result);
    }
  } catch (e) {
    // Не должно случаться (recognizeFile сам ловит свои ошибки), но если всё же
    // что-то пробьётся сюда — не оставляем интерфейс молча зависшим.
    console.error('Распознавание прервалось неожиданной ошибкой:', e);
    alert('Распознавание остановилось из-за ошибки: ' + (e && e.message ? e.message : String(e)));
  }

  finishProgress(cancelled);

  if (fileResults.length) {
    showResults(fileResults);
    saveResultsToStorage(fileResults);
  }

  unlockControls();
  recognizeBtn.textContent = cancelled
    ? `Распознавание отменено — распознать заново (${selectedFiles.length})`
    : `Распознать заново (${selectedFiles.length})`;
});

// --- Экспорт: модули export/*.js получают уже готовые данные, сами DOM не читают ---

copyAllBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(buildAllText(getFileGroups()));
    copyAllBtn.textContent = 'Скопировано';
    setTimeout(() => copyAllBtn.textContent = 'Скопировать весь текст', 1500);
  } catch (e) {
    alert('Не удалось скопировать — выделите текст вручную.');
  }
});

downloadBtn.addEventListener('click', () => downloadTxt(getFileGroups()));
downloadXlsxBtn.addEventListener('click', () => downloadXlsx(getFileGroups()));

downloadPdfBtn.addEventListener('click', () => {
  const originalLabel = downloadPdfBtn.textContent;
  downloadPdfBtn.disabled = true;
  downloadPdfBtn.textContent = 'Готовим PDF…';

  downloadPdf(getFileGroups(), err => {
    if (err) alert('Не удалось создать PDF: ' + (err.message || String(err)));
    downloadPdfBtn.disabled = false;
    downloadPdfBtn.textContent = originalLabel;
  });
});
