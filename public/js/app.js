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
import { downloadSummaryReport } from './export/summaryReport.js';
import { downloadCsv } from './export/csvExport.js';
import { downloadJson } from './export/jsonExport.js';
import { downloadZip } from './export/zipExport.js';
import { initFileList, getSelectedFiles, getSelectedDocTypes, getExtraDocTypes, setControlsDisabled, addExternalFile } from './ui/fileList.js';
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
import { initBranding, getClientSlug, getClientToken, getClientBranding } from './branding.js';

// White-label фасад для клиентских пилотов (?client=slug в URL) — см. branding.js.
// Не блокирует остальную инициализацию: fail-open при сбое сети.
initBranding();

// Сколько страниц распознавать одновременно в режиме Gemini. Раньше запросы шли
// строго по одному (файл-за-файлом, страница-за-страницей) — весь пакет из,
// скажем, 10 однострочных документов ждал 10 последовательных round-trip'ов.
// Само по себе ограничение параллелизма НЕ защищает от превышения лимита в
// минуту (см. rateLimiter.js) — это отдельный механизм ниже.
//
// Поднято с 10 до 25 (7 сен 2026) — Ethan прогнал живую пачку из 18 разных
// документов (паспорта/инвойсы/счета-фактуры) при старом значении 10: заняло
// 51 секунду, попросил, чтобы бОльшая пачка не ждала освобождения "слота"
// (пул runWithConcurrency при limit=10 держит только 10 задач в полёте
// одновременно — 11-я стартует лишь когда закончится одна из первых десяти,
// см. concurrencyPool.js). Раньше при GEMINI_RPM_BUDGET=14 держать конкуренцию
// низкой было осмысленно (иначе почти все 10 воркеров сразу упирались бы в
// rateLimiter.acquire() и просто ждали бы там, а не на латентности Gemini) —
// но с бюджетом 200/мин (см. ниже) при 18 запросах за минуту реальный лимитер
// вообще не был узким местом (18 << 200) — всё время ушло на латентность самих
// запросов при недостаточной конкуренции. 25 даёт запас для пачек побольше
// (скажем, ~40-60 многостраничных файлов) без риска упереться в RPM-бюджет
// раньше, чем в латентность (rateLimiter всё равно остаётся настоящей защитой
// от 429, это значение — просто потолок "сколько разрешено пытаться сразу").
// Вебсокеты/лимиты на одновременные serverless-вызовы Vercel здесь не при чём —
// Hobby/Pro не ограничивают параллельные вызовы функций фиксированным числом
// (см. vercel.com/docs/limits), ограничена только их длительность (60 сек/вызов,
// уже обрабатывается отдельно, см. 504 в geminiRecognizeClient.js).
const MAX_CONCURRENT_REQUESTS = 25;

// Бюджет запросов к Gemini в минуту — ЭТО настоящая защита от 429, а не
// MAX_CONCURRENT_REQUESTS выше (тот лишь ограничивает число задач в полёте
// одновременно, не темп во времени).
//
// Cloud Billing подтверждён Ethan'ом (7 сен 2026) — реальный лимит проекта
// на Tier 1 проверен напрямую в AI Studio → Rate Limits для модели
// gemini-3.6-flash: 1000 RPM / 2 000 000 TPM / 10 000 RPD (запросов в день).
// Взято 200 — не сам потолок 1000, чтобы: (1) не упереться в TPM или RPD
// раньше, чем в RPM, на тяжёлых пачках; (2) оставить запас, т.к. ключ общий
// на все каналы разом (сайт клиентов, анонимный сайт, публичный API — см.
// хендовер) и делится между ОДНОВРЕМЕННЫМИ сессиями разных пользователей,
// не только текущей вкладкой. 200 всё равно с запасом выше того, что способен
// создать один браузер даже при MAX_CONCURRENT_REQUESTS=25 (см. выше) — при
// разумной латентности Gemini пришлось бы держать 25 воркеров занятыми
// одновременно ощутимо больше минуты подряд, чтобы упереться в этот потолок,
// а на практике пачки заканчиваются раньше — так что искусственное
// дросселирование снято полностью, но потолок 1000 остаётся далёким даже при
// нескольких пачках параллельно.
// Если понадобится больше — можно поднимать дальше, вплоть до, скажем, 700-800,
// с тем же запасом ~20-30% под TPM/RPD и другие каналы.
const GEMINI_RPM_BUDGET = 200;
// let, не const — приоритетная обработка (см. computeEffectiveLimits ниже)
// пересоздаёт лимитер с более широким бюджетом для премиум-клиента ПЕРЕД
// стартом конкретного прогона. recognizePage() всегда читает актуальное
// значение через замыкание (обычное поведение let в JS), поэтому отдельно
// прокидывать лимитер параметром через весь стек вызовов не нужно.
let geminiRateLimiter = createRateLimiter(GEMINI_RPM_BUDGET, 60000);

// Приоритетная обработка (Ethan, 7 сен 2026, премиум-функция): клиент с
// настроенным formatting.maxConcurrency (см. lib/customFieldsLookup.js,
// /admin) получает более широкий персональный потолок одновременных
// запросов вместо общего MAX_CONCURRENT_REQUESTS — свой пакет обрабатывается
// быстрее. ВАЖНО (честно, а не как маркетинг): это НЕ настоящая приоритетная
// очередь — сервер ничего не знает про приоритет, у него нет общей очереди
// между разными клиентами вообще (см. обсуждение архитектуры). Это просто
// более широкий личный лимит параллелизма+темпа именно для запросов этого
// клиента — его собственная пачка идёт быстрее, а не "обгоняет" чужие.
//
// RPM-бюджет масштабируется вместе с конкурентностью в той же пропорции, что
// сейчас у дефолта (200/25 = 8) — иначе более широкий MAX_CONCURRENT просто
// упирался бы в старый RPM-потолок и не давал реального ускорения (см.
// комментарий выше про GEMINI_RPM_BUDGET=14 в старой версии). Верхний предел
// на сам RPM-бюджет (500) — защита общего ключа Gemini (реальный потолок
// проекта 1000 RPM, см. комментарий у GEMINI_RPM_BUDGET, делится между ВСЕМИ
// каналами и клиентами одновременно) от одного неверно настроенного клиента.
function computeEffectiveLimits() {
  const branding = getClientBranding();
  const configured = branding && branding.maxConcurrency;
  if (!configured || configured <= MAX_CONCURRENT_REQUESTS) {
    return { concurrency: MAX_CONCURRENT_REQUESTS, rpmBudget: GEMINI_RPM_BUDGET };
  }
  const rpmBudget = Math.min(500, Math.round(configured * (GEMINI_RPM_BUDGET / MAX_CONCURRENT_REQUESTS)));
  return { concurrency: configured, rpmBudget };
}

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
const downloadSummaryBtn = document.getElementById('downloadSummaryBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const maskSensitiveToggle = document.getElementById('maskSensitiveToggle');

// Опции экспорта — не влияют на распознавание или показ в интерфейсе, только
// на то, что уходит в скачиваемый файл. maskSensitive — см. export/sensitiveFields.js.
// branding — лого/название клиента (см. branding.js:getClientBranding), для
// обычного посетителя без ?client= всегда null — экспорт выглядит как раньше.
function exportOptions() {
  return {
    maskSensitive: !!(maskSensitiveToggle && maskSensitiveToggle.checked),
    branding: getClientBranding()
  };
}
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

// null-safe минимум — confidence может быть null (Tesseract, __unparsed-ответ,
// не-числовая оценка от Gemini, см. lib/fieldFormat.js:normalizeConfidence);
// null означает «оценки нет», а не «наихудшая оценка», поэтому Math.min напрямую
// не годится (Math.min(90, null) === 0 из-за приведения null к 0 — испортило бы
// вполне уверенный документ). Отсутствие оценки просто не участвует в минимуме.
function minConfidence(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

// Распознаёт одну страницу выбранным движком. Возвращает { rawText, docType, fields, items, confidence }.
// docType/fields/items/confidence заполняются только Gemini-режимом (Tesseract их не знает — см. классификацию ниже).
// confidence — самооценка модели (0-100) или null, если оценки нет (см. lib/confidence.js).
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
    const clientToken = getClientToken(); // токен гейта паролем, если у клиента он задан — см. branding.js
    await geminiRateLimiter.acquire(signal);
    const result = await recognizeWithGemini(pageImage, presetType, { onRetry, signal, clientSlug, clientToken });
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
        const tableResult = await recognizeWithGemini(pageImage, result.docType, { skipOcr: true, onRetry, signal, clientSlug, clientToken });
        // Два запроса на одну страницу (классификация+текст, потом строки таблицы) —
        // берём худшую (минимальную) из двух оценок, т.к. обе относятся к одному и
        // тому же документу: низкая уверенность в любой из частей (что это за тип,
        // или что строки таблицы верны) одинаково значима для решения «перепроверить».
        return { rawText: result.text, docType: result.docType, fields: result.fields, items: tableResult.items, columns: tableResult.columns, columnKeys: tableResult.columnKeys, confidence: minConfidence(result.confidence, tableResult.confidence) };
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        // Второй запрос не удался (например, 504) — не роняем страницу целиком: текст
        // и определённый тип у нас уже есть, таблица просто останется пустой для
        // ручного заполнения, как раньше при ручном выборе табличного типа. confidence —
        // только от первого запроса (единственная оценка, которая у нас есть).
        console.error('Авто-извлечение таблицы не удалось, оставляем текст и тип без строк:', e);
        return { rawText: result.text, docType: result.docType, fields: result.fields, items: null, columns: null, columnKeys: null, confidence: result.confidence };
      }
    }
    return { rawText: result.text, docType: result.docType, fields: result.fields, items: result.items, columns: result.columns, columnKeys: result.columnKeys, confidence: result.confidence };
  }
  const rawText = await recognizeWithTesseract(pageImage, lang, m => {
    const pct = Math.round(m.progress * 100);
    const stage = (m.status.includes('loading') || m.status.includes('load')) ? 'Загружаем движок' : 'Распознаём';
    onStatus(`${stage}… ${pct}%`);
  });
  // Офлайн-режим не даёт сопоставимой оценки уверенности (Tesseract возвращает
  // символьную OCR-точность, не «правильно ли извлечены поля») — не подменяем
  // одно другим, честно null: бейдж на фронтенде просто не покажется.
  return { rawText, docType: null, fields: null, items: null, columns: null, columnKeys: null, confidence: null };
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
// isKnownDocType — DOC_TYPES ИЛИ кастомный тип этого клиента (Ethan, 8 сен
// 2026: настоящая причина, по которой кастомный тип всегда падал до
// "Другое" — finalizeFileResult ниже проверял docType только по стандартному
// DOC_TYPES (lib/docSchema.js), не зная о кастомных типах клиента вообще, и
// молча заменял ЛЮБОЙ кастомный тип на "Другое" — даже когда сервер (или сам
// человек вручную, см. selectedDocTypes в fileList.js) верно определил именно
// кастомный тип. Это НЕ имело отношения к качеству классификации Gemini (см.
// коммит про добавление списка полей в подсказку) — сброс происходил уже НА
// КЛИЕНТЕ, после ответа сервера. Объявлена на уровне модуля, а не внутри
// finalizeFileResult — нужна и в try, и в catch этой функции (см. ниже).
function isKnownDocType(t) {
  return DOC_TYPES.includes(t) || getExtraDocTypes().includes(t);
}

function finalizeFileResult(entry, mode) {
  let fileDocType = entry.presetType;
  let fileFields = null;
  let fileItems = null;
  let fileColumns = null;
  let fileColumnKeys = null;
  // В отличие от docType/fields/items (берутся с ПЕРВОЙ подходящей страницы —
  // см. комментарий выше), уверенность сводим по ВСЕМ страницам файла минимумом:
  // клиенту важно, что хотя бы одна страница вызвала сомнение у модели, а не
  // только первая — иначе смазанная последняя страница многостраничного
  // документа осталась бы никак не отмеченной.
  let fileConfidence = null;
  for (const rec of entry.pageRecognized) {
    if (!rec) continue;
    if (!entry.presetType && fileDocType == null && rec.docType) fileDocType = rec.docType;
    if (fileFields === null && rec.fields) fileFields = rec.fields;
    if (fileItems === null && rec.items) { fileItems = rec.items; fileColumns = rec.columns || null; fileColumnKeys = rec.columnKeys || null; }
    fileConfidence = minConfidence(fileConfidence, rec.confidence);
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
    // isKnownDocType (см. объявление на уровне модуля выше) — DOC_TYPES ИЛИ
    // кастомный тип этого клиента, не только стандартные 21.
    if (!fileDocType || !isKnownDocType(fileDocType)) fileDocType = 'Другое';

    // Извлечение полей (независимый модуль) — только если Gemini их ещё не вернул в этом же запросе.
    fields = isTableType(fileDocType) ? [] : (fileFields || extractFieldsHeuristic(joinedText, fileDocType));
    // Товарные строки: офлайн-эвристика их не производит (см. heuristicExtractor.js) —
    // без Gemini таблица придёт пустой, пользователь заполнит вручную в интерфейсе.
    items = fileItems || [];
  } catch (e) {
    console.error('Классификация/извлечение полей упали, файл всё равно вернём с текстом:', e);
    fileDocType = isKnownDocType(fileDocType) ? fileDocType : 'Другое';
  }

  return { fileName: entry.file.name, pages: entry.pageTexts, docType: fileDocType, fields, items, columns: fileColumns, columnKeys: fileColumnKeys, confidence: fileConfidence };
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

  // Пересчитываем лимиты ПЕРЕД стартом этого конкретного прогона (не один раз
  // при загрузке страницы) — на момент загрузки модуля клиентский конфиг ещё
  // не успел прийти (initBranding — fire-and-forget), а здесь пользователь уже
  // выбрал файлы и нажал «Распознать», так что fetch почти наверняка успел.
  const { concurrency: effectiveConcurrency, rpmBudget: effectiveRpmBudget } = computeEffectiveLimits();
  if (effectiveRpmBudget !== GEMINI_RPM_BUDGET) {
    geminiRateLimiter = createRateLimiter(effectiveRpmBudget, 60000);
  }

  await runWithConcurrency(tasks, mode === 'gemini' ? effectiveConcurrency : 1, async ([fileIndex, pageIndex]) => {
    const entry = fileEntries[fileIndex];
    setPageStatus(fileIndex, pageIndex, 'Распознаём…');
    try {
      const { rawText, docType, fields, items, columns, columnKeys, confidence } = await recognizePage(
        entry.pageImages[pageIndex], mode, lang, entry.presetType,
        abortController.signal,
        status => setPageStatus(fileIndex, pageIndex, status)
      );
      entry.pageRecognized[pageIndex] = { docType, fields, items, columns, columnKeys, confidence };
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
downloadXlsxBtn.addEventListener('click', () => downloadXlsx(getFileGroups(), exportOptions()));
downloadCsvBtn.addEventListener('click', () => downloadCsv(getFileGroups(), exportOptions()));
downloadJsonBtn.addEventListener('click', () => downloadJson(getFileGroups(), exportOptions()));

downloadPdfBtn.addEventListener('click', () => {
  const originalLabel = downloadPdfBtn.textContent;
  downloadPdfBtn.disabled = true;
  downloadPdfBtn.textContent = 'Готовим PDF…';

  downloadPdf(getFileGroups(), err => {
    if (err) showToast('Не удалось создать PDF: ' + (err.message || String(err)), 'error');
    downloadPdfBtn.disabled = false;
    downloadPdfBtn.textContent = originalLabel;
  }, exportOptions());
});

// Сводный отчёт по пачке (см. export/summaryReport.js) — не зависит от
// maskSensitive (сводка не содержит значений полей документа), но branding
// передаём тем же exportOptions(), что и остальные экспорты — единообразный
// брендированный вид для премиум-клиента везде, а не только в подетальном PDF.
downloadSummaryBtn.addEventListener('click', () => {
  const originalLabel = downloadSummaryBtn.textContent;
  downloadSummaryBtn.disabled = true;
  downloadSummaryBtn.textContent = 'Готовим отчёт…';

  downloadSummaryReport(getFileGroups(), err => {
    if (err) showToast('Не удалось создать сводный отчёт: ' + (err.message || String(err)), 'error');
    downloadSummaryBtn.disabled = false;
    downloadSummaryBtn.textContent = originalLabel;
  }, exportOptions());
});

// ZIP-экспорт пачки (см. export/zipExport.js) — все 6 форматов одним архивом
// (Ethan, 7 сен 2026: "Все 6 форматов (включая PDF и сводный отчёт)"),
// exportOptions() те же, что у остальных кнопок — единообразное маскирование/
// брендирование внутри архива, как и в отдельных кнопках экспорта.
downloadZipBtn.addEventListener('click', () => {
  const originalLabel = downloadZipBtn.textContent;
  downloadZipBtn.disabled = true;
  downloadZipBtn.textContent = 'Собираем архив…';

  downloadZip(getFileGroups(), err => {
    if (err) showToast('Не удалось собрать ZIP: ' + (err.message || String(err)), 'error');
    downloadZipBtn.disabled = false;
    downloadZipBtn.textContent = originalLabel;
  }, exportOptions());
});
