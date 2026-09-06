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
import { initFileList, getSelectedFiles, getSelectedDocTypes, setControlsDisabled, addExternalFile } from './ui/fileList.js';
import {
  startProgress, finishProgress, setOverallProgress,
  createFileProgressGroup, addPageRows, showFileOpenError, setPageStatus, markPageDone, markPageError,
  setDefaultHideCompleted, setProgressSummary
} from './ui/progress.js';
import { showResults, hideResults, initResultsCollapseToggle, getFileGroups } from './ui/results.js';
import { initSettings, getSelectedMode, getSelectedLang } from './ui/settings.js';
import { showToast, showConfirm } from './ui/notify.js';
import { isTableType, DOC_TYPES } from './config/docSchema.js';
import { runWithConcurrency } from './utils/concurrencyPool.js';
import { createRateLimiter } from './utils/rateLimiter.js';
import { initBranding, getClientSlug } from './branding.js';

// White-label фасад для клиентских пилотов (?client=slug в URL) — см. branding.js.
// Не блокирует остальную инициализацию: fail-open при сбое сети.
initBranding();

// Сколько страниц распознавать одновременно в режиме Gemini. Раньше запросы шли
// строго по одному (файл-за-файлом, страница-за-страницей) — весь пакет из,
// скажем, 10 однострочных документов ждал 10 последовательных round-trip'ов.
// Само по себе ограничение параллелизма НЕ защищает от превышения лимита в
// минуту (см. rateLimiter.js) — это отдельный механизм ниже. Поднято до 10
// по запросу — само число 10 безопасно при любом тарифе Gemini, реальную
// защиту от 429 даёт GEMINI_RPM_BUDGET ниже, а не это значение.
const MAX_CONCURRENT_REQUESTS = 10;

// Бюджет запросов к Gemini в минуту — ЭТО настоящая защита от 429, а не
// MAX_CONCURRENT_REQUESTS выше (тот лишь ограничивает число задач в полёте
// одновременно, не темп во времени).
//
// ВАЖНО: держим консервативно (под бесплатный тариф, 20/мин), пока не
// подтверждено, что на проекте включён Cloud Billing — это отдельная вещь
// от подписки Google AI Pro/Ultra в приложении Gemini: подписка Pro/Ultra
// НЕ увеличивает лимиты API-ключа, который использует Тамга, только доступ
// внутри AI Studio Playground. Чтобы реально поднять лимит (обычно до
// ~150-300 запросов/мин на Flash-моделях после включения биллинга — точное
// число смотреть в AI Studio → проект → Rate Limits), нужно привязать
// карту к Cloud-проекту. Как только это подтверждено — поднять это число.
const GEMINI_RPM_BUDGET = 14;
const geminiRateLimiter = createRateLimiter(GEMINI_RPM_BUDGET, 60000);

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
const tryDemoBtn = document.getElementById('tryDemoBtn');

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

// --- Демо-документ одной кнопкой: синтетическая накладная (см. public/demo/),
// чтобы человек мог сразу увидеть результат, не выбирая свой файл. ---
tryDemoBtn.addEventListener('click', async () => {
  const originalLabel = tryDemoBtn.textContent;
  tryDemoBtn.disabled = true;
  tryDemoBtn.textContent = 'Загружаем пример…';
  try {
    const res = await fetch('/demo/demo-nakladnaya.pdf');
    if (!res.ok) throw new Error(`Не удалось загрузить пример (${res.status})`);
    const blob = await res.blob();
    const file = new File([blob], 'demo-nakladnaya.pdf', { type: 'application/pdf' });
    addExternalFile(file);
    recognizeBtn.click();
  } catch (e) {
    showToast('Не удалось загрузить пример: ' + (e && e.message ? e.message : String(e)), 'error');
  } finally {
    tryDemoBtn.disabled = false;
    tryDemoBtn.textContent = originalLabel;
  }
});

// --- Восстановление результатов с прошлого визита ---
const savedResults = loadSavedResults();
if (savedResults) restoreBanner.style.display = 'block';

restoreBtn.addEventListener('click', () => {
  const results = loadSavedResults();
  if (results) {
    showResults(results);
  } else {
    showToast('Не удалось восстановить результаты — данные повреждены.', 'error');
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
async function recognizePage(pageImage, mode, lang, presetType, signal, onStatus) {
  if (mode === 'gemini') {
    const onRetry = ({ attempt, maxAttempts, delayMs, status }) => {
      const sec = Math.ceil(delayMs / 1000);
      // status === 429 — превышен лимит бесплатного тарифа; 503 — модель Gemini
      // временно перегружена ("high demand"). Формулировка разная, повтор один и тот же.
      const reason = status === 429 ? 'Превышен лимит запросов' : 'Сервис Gemini временно перегружен';
      onStatus(`${reason}, ждём ${sec} сек… (попытка ${attempt}/${maxAttempts})`);
    };
    const clientSlug = getClientSlug(); // white-label пилот (?client=slug) — см. branding.js
    await geminiRateLimiter.acquire(signal);
    const result = await recognizeWithGemini(pageImage, presetType, { onRetry, signal, clientSlug });
    const needsTableFollowUp = !presetType && isTableType(result.docType) && (!result.items || result.items.length === 0);
    if (needsTableFollowUp) {
      onStatus('Извлекаем таблицу…');
      try {
        // skipOcr: true — text уже есть от первого запроса (result.text), повторно
        // просить у Gemini полную OCR-расшифровку в этом запросе незачем: это
        // чистая избыточность, раздувающая объём ответа без пользы (см. лог рефакторинга).
        await geminiRateLimiter.acquire(signal); // это ОТДЕЛЬНЫЙ запрос — тоже считается в лимит
        // Колонки берутся из ВТОРОГО запроса (tableResult), не из первого — у
        // первого их не может быть: та классификация ещё не знала тип, поэтому
        // сервер не мог решить, нужен ли override (см. lib/recognize.js:tableColumns).
        const tableResult = await recognizeWithGemini(pageImage, result.docType, { skipOcr: true, onRetry, signal, clientSlug });
        return { rawText: result.text, docType: result.docType, fields: result.fields, items: tableResult.items, columns: tableResult.columns, columnKeys: tableResult.columnKeys };
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        // Второй запрос не удался (например, 504) — не роняем страницу целиком: текст
        // и определённый тип у нас уже есть, таблица просто останется пустой для
        // ручного заполнения, как раньше при ручном выборе табличного типа.
        console.error('Авто-извлечение таблицы не удалось, оставляем текст и тип без строк:', e);
        return { rawText: result.text, docType: result.docType, fields: result.fields, items: null, columns: null, columnKeys: null };
      }
    }
    return { rawText: result.text, docType: result.docType, fields: result.fields, items: result.items, columns: result.columns, columnKeys: result.columnKeys };
  }
  const rawText = await recognizeWithTesseract(pageImage, lang, m => {
    const pct = Math.round(m.progress * 100);
    const stage = (m.status.includes('loading') || m.status.includes('load')) ? 'Загружаем движок' : 'Распознаём';
    onStatus(`${stage}… ${pct}%`);
  });
  return { rawText, docType: null, fields: null, items: null, columns: null, columnKeys: null };
}

// Собирает финальный результат по файлу из уже распознанных страниц (без сети —
// сама сеть теперь в общем пуле ниже, по всем файлам сразу, а не файл-за-файлом).
// entry.pageRecognized[i] — { docType, fields, items, columns, columnKeys } для
// успешно распознанной страницы i, или null для страницы, где распознавание не удалось.
//
// "Первая страница с полями побеждает" — здесь это детерминированно, по порядку
// страниц (индексу), а НЕ по тому, какой запрос вернулся первым: при параллельных
// запросах случайная задержка сети иначе решала бы, какая страница считается
// главной — а это должно зависеть от структуры документа, а не от таймингов сети.
function finalizeFileResult(entry, mode) {
  let fileDocType = entry.presetType;
  let fileFields = null;
  let fileItems = null;
  let fileColumns = null;
  let fileColumnKeys = null;
  for (const rec of entry.pageRecognized) {
    if (!rec) continue;
    if (!entry.presetType && fileDocType == null && rec.docType) fileDocType = rec.docType;
    if (fileFields === null && rec.fields) fileFields = rec.fields;
    if (fileItems === null && rec.items) { fileItems = rec.items; fileColumns = rec.columns || null; fileColumnKeys = rec.columnKeys || null; }
  }

  // Классификация и извлечение полей не должны молча ронять весь сценарий: если
  // здесь что-то пойдёт не так (например, неожиданный формат от Gemini или
  // classifyByKeywords), файл всё равно попадёт в результаты с распознанным
  // текстом и типом «Другое» — лучше так, чем зависшая кнопка и пустой экран.
  let fields = [];
  let items = [];
  try {
    const joinedText = entry.pageTexts.join('\n');
    // Классификация (независимый модуль) — только если тип не был известен заранее и не пришёл от Gemini.
    if (!entry.presetType && !fileDocType && mode === 'tesseract') {
      fileDocType = classifyByKeywords(joinedText);
    }
    if (!fileDocType || !DOC_TYPES.includes(fileDocType)) fileDocType = 'Другое';

    // Извлечение полей (независимый модуль) — только если Gemini их ещё не вернул в этом же запросе.
    fields = isTableType(fileDocType) ? [] : (fileFields || extractFieldsHeuristic(joinedText, fileDocType));
    // Товарные строки: офлайн-эвристика их не производит (см. heuristicExtractor.js) —
    // без Gemini таблица придёт пустой, пользователь заполнит вручную в интерфейсе.
    items = fileItems || [];
  } catch (e) {
    console.error('Классификация/извлечение полей упали, файл всё равно вернём с текстом:', e);
    fileDocType = DOC_TYPES.includes(fileDocType) ? fileDocType : 'Другое';
  }

  return { fileName: entry.file.name, pages: entry.pageTexts, docType: fileDocType, fields, items, columns: fileColumns, columnKeys: fileColumnKeys };
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
    const proceed = await showConfirm(
      `Для типа(ов) ${typesList} офлайн-режим не распознаёт строки таблицы — таблицу придётся заполнять вручную.\n\n` +
      'Рекомендуем переключиться на режим «Текст + поля».',
      { confirmLabel: 'Продолжить офлайн', cancelLabel: 'Отмена' }
    );
    if (!proceed) return;
  }

  restoreBanner.style.display = 'none';
  let cancelled = false;
  const abortController = new AbortController();

  lockControls();
  hideResults();
  startProgress(() => {
    cancelled = true;
    cancelTesseract();
    abortController.abort(); // прерывает и уже летящие запросы к Gemini, и паузы между повторами
  });

  // Фаза 1: открыть все файлы и подготовить строки прогресса — быстро, локально,
  // без сети, поэтому делаем последовательно (нет смысла распараллеливать).
  const fileEntries = [];
  for (let f = 0; f < selectedFiles.length; f++) {
    const file = selectedFiles[f];
    const pagesWrap = createFileProgressGroup(f, file.name);
    let pageImages;
    try {
      pageImages = await loadPageImages(file);
    } catch (e) {
      showFileOpenError(pagesWrap);
      fileEntries.push(null);
      continue;
    }
    addPageRows(pagesWrap, f, pageImages.length);
    const presetType = selectedDocTypes[f] && selectedDocTypes[f] !== 'auto' ? selectedDocTypes[f] : null;
    fileEntries.push({
      file,
      presetType,
      pageImages,
      pageTexts: new Array(pageImages.length).fill(''),
      pageRecognized: new Array(pageImages.length).fill(null)
    });
  }

  // Фаза 2: сами запросы распознавания — независимо по всем страницам всех файлов
  // сразу (а не строго по одному файл-за-файлом/страница-за-страницей, как было
  // раньше), но с ограничением на число одновременных запросов. Ограничение —
  // не искусственное, а чтобы не упереться в лимит бесплатного тарифа Gemini
  // (20 запросов/мин) при большом пакете файлов; для офлайн-режима (Tesseract)
  // держим по одному, т.к. tesseractClient.js хранит один активный воркер —
  // параллельные вызовы сломали бы отмену и были бы тяжелы для мобильных браузеров.
  const tasks = [];
  for (let f = 0; f < fileEntries.length; f++) {
    if (!fileEntries[f]) continue;
    for (let i = 0; i < fileEntries[f].pageImages.length; i++) tasks.push([f, i]);
  }
  const totalTasks = tasks.length;
  let completedCount = 0;
  let doneCount = 0;
  let errorCount = 0;
  recognizeBtn.textContent = totalTasks ? 'Распознаём…' : 'Распознавание…';
  setProgressSummary(0, 0, totalTasks);
  // Порог подобран на глаз: до ~20 страниц интереснее видеть весь список целиком,
  // после — список из десятков успешных файлов только мешает следить за тем, что
  // ещё в процессе или упало (см. жалобу на неудобство при 50-100 документах).
  setDefaultHideCompleted(totalTasks > 20);

  await runWithConcurrency(tasks, mode === 'gemini' ? MAX_CONCURRENT_REQUESTS : 1, async ([fileIndex, pageIndex]) => {
    const entry = fileEntries[fileIndex];
    setPageStatus(fileIndex, pageIndex, 'Распознаём…');
    try {
      const { rawText, docType, fields, items, columns, columnKeys } = await recognizePage(
        entry.pageImages[pageIndex], mode, lang, entry.presetType,
        abortController.signal,
        status => setPageStatus(fileIndex, pageIndex, status)
      );
      entry.pageRecognized[pageIndex] = { docType, fields, items, columns, columnKeys };
      entry.pageTexts[pageIndex] = postProcessText(rawText, { cleanup: true, normalize: postProcessCheckbox.checked });
      markPageDone(fileIndex, pageIndex, 'Готово');
      doneCount++;
    } catch (e) {
      const isAbort = e && e.name === 'AbortError';
      markPageError(fileIndex, pageIndex, isAbort ? 'Отменено' : (e && e.message ? e.message : String(e)));
      errorCount++;
    }
    completedCount++;
    setProgressSummary(doneCount, errorCount, totalTasks);
    setOverallProgress(totalTasks ? completedCount / totalTasks : 1);
  }, () => cancelled);

  // Фаза 3: сборка финального результата по каждому файлу — без сети, детерминированно
  // (см. комментарий в finalizeFileResult про порядок страниц, а не порядок завершения запросов).
  const fileResults = [];
  for (const entry of fileEntries) {
    if (entry) fileResults.push(finalizeFileResult(entry, mode));
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
    showToast('Не удалось скопировать — выделите текст вручную.', 'error');
  }
});

downloadBtn.addEventListener('click', () => downloadTxt(getFileGroups()));
downloadXlsxBtn.addEventListener('click', () => downloadXlsx(getFileGroups()));

downloadPdfBtn.addEventListener('click', () => {
  const originalLabel = downloadPdfBtn.textContent;
  downloadPdfBtn.disabled = true;
  downloadPdfBtn.textContent = 'Готовим PDF…';

  downloadPdf(getFileGroups(), err => {
    if (err) showToast('Не удалось создать PDF: ' + (err.message || String(err)), 'error');
    downloadPdfBtn.disabled = false;
    downloadPdfBtn.textContent = originalLabel;
  });
});
