// Точка входа приложения. Сама не содержит бизнес-логики распознавания,
// классификации или извлечения — только вызывает независимые модули
// в нужном порядке и передаёт данные между ними.

import { classifyByKeywords } from './classification/keywordClassifier.js';
import { extractFieldsHeuristic } from './extraction/heuristicExtractor.js';
import { postProcessText } from './postprocess/textCleanup.js';
import { loadPdfPages } from './ocr/pdfLoader.js';
import { loadImageFile } from './ocr/imageLoader.js';
import { recognizeWithTesseract } from './ocr/tesseractClient.js';
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

const recognizeBtn = document.getElementById('recognizeBtn');
const langSelect = document.getElementById('langSelect');
const modeSelect = document.getElementById('modeSelect');
const postProcessCheckbox = document.getElementById('postProcessCheckbox');
const cleanupCheckbox = document.getElementById('cleanupCheckbox');
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
  cleanupCheckbox.disabled = true;
}

function unlockControls() {
  recognizeBtn.disabled = false;
  setControlsDisabled(false);
  langSelect.querySelectorAll('input').forEach(el => el.disabled = false);
  modeSelect.querySelectorAll('input').forEach(el => el.disabled = false);
  postProcessCheckbox.disabled = false;
  cleanupCheckbox.disabled = false;
}

async function loadPageImages(file) {
  return file.type === 'application/pdf' ? loadPdfPages(file) : loadImageFile(file);
}

// Распознаёт одну страницу выбранным движком. Возвращает { rawText, docType, fields }.
// docType/fields заполняются только Gemini-режимом (Tesseract их не знает — см. классификацию ниже).
async function recognizePage(pageImage, mode, lang, presetType, onTesseractProgress) {
  if (mode === 'gemini') {
    const result = await recognizeWithGemini(pageImage, presetType);
    return { rawText: result.text, docType: result.docType, fields: result.fields };
  }
  const rawText = await recognizeWithTesseract(pageImage, lang, onTesseractProgress);
  return { rawText, docType: null, fields: null };
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

  for (let i = 0; i < pageImages.length; i++) {
    setPageStatus(fileIndex, i, 'Распознаём…');
    recognizeBtn.textContent = `Файл ${fileIndex + 1} из ${totalFiles}, страница ${i + 1} из ${pageImages.length}…`;

    try {
      const { rawText, docType, fields } = await recognizePage(pageImages[i], mode, lang, presetType, m => {
        const pct = Math.round(m.progress * 100);
        const stage = (m.status.includes('loading') || m.status.includes('load')) ? 'Загружаем движок' : 'Распознаём';
        recognizeBtn.textContent = `${stage}… файл ${fileIndex + 1}/${totalFiles}, стр. ${i + 1}/${pageImages.length} — ${pct}%`;
      });

      // Тип уже задан пользователем — не даём Gemini-классификации его переопределить.
      if (!presetType && fileDocType === null && docType) fileDocType = docType;
      // Поля от Gemini берём в любом случае (даже если тип задан вручную): бэкенд теперь
      // извлекает их именно под этот тип (см. lib/extraction.js), так что они надёжнее
      // локальной regex-эвристики ниже, которая остаётся только запасным вариантом.
      if (fileFields === null && fields) fileFields = fields;

      pageTexts.push(postProcessText(rawText, { cleanup: cleanupCheckbox.checked, normalize: postProcessCheckbox.checked }));
      markPageDone(fileIndex, i, 'Готово');
    } catch (e) {
      pageTexts.push('');
      markPageError(fileIndex, i, e && e.message ? e.message : String(e));
    }

    setOverallProgress((fileIndex + (i + 1) / pageImages.length) / totalFiles);
  }

  // Классификация (независимый модуль) — только если тип не был известен заранее и не пришёл от Gemini.
  if (!presetType && mode === 'tesseract') {
    fileDocType = classifyByKeywords(pageTexts.join('\n'));
  }
  fileDocType = fileDocType || 'Другое';

  // Извлечение полей (независимый модуль) — только если Gemini их ещё не вернул в этом же запросе.
  const joinedText = pageTexts.join('\n');
  const fields = fileFields || extractFieldsHeuristic(joinedText, fileDocType);

  return { fileName: file.name, pages: pageTexts, docType: fileDocType, fields };
}

recognizeBtn.addEventListener('click', async () => {
  const selectedFiles = getSelectedFiles();
  const selectedDocTypes = getSelectedDocTypes();
  if (selectedFiles.length === 0) return;

  const mode = getSelectedMode();
  const lang = getSelectedLang();

  restoreBanner.style.display = 'none';
  let cancelled = false;

  lockControls();
  hideResults();
  startProgress(() => { cancelled = true; });

  const fileResults = [];
  for (let f = 0; f < selectedFiles.length; f++) {
    if (cancelled) break;
    const presetType = selectedDocTypes[f] && selectedDocTypes[f] !== 'auto' ? selectedDocTypes[f] : null;
    const result = await recognizeFile(selectedFiles[f], f, selectedFiles.length, mode, lang, presetType);
    if (result) fileResults.push(result);
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
