// Точка входа приложения. Сама не содержит бизнес-логики распознавания,
// классификации или извлечения — только вызывает независимые модули
// в нужном порядке и передаёт данные между ними.

import { classifyByKeywords } from './classification/keywordClassifier.js';
import { extractFieldsHeuristic } from './extraction/heuristicExtractor.js';
import { postProcessText } from './postprocess/textCleanup.js';
import { iterateFilePages, releasePageImage } from './ocr/pageSource.js';
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
import { initFeedback } from './ui/feedback.js';
import { initTranslation } from './translation/panel.js';
import {
  startProgress, finishProgress, setOverallProgress,
  createFileProgressGroup, addPageRows, showFileOpenError, setPageStatus, markPageDone, markPageError,
  setDefaultHideCompleted, setProgressSummary
} from './ui/progress.js';
import { showResults, hideResults, initResultsCollapseToggle, getFileGroups } from './ui/results.js';
import { initSettings, getSelectedMode, getSelectedLang } from './ui/settings.js';
import { showToast, showConfirm } from './ui/notify.js';
import { isTableType, DOC_TYPES } from './config/docSchema.js';
import { runStreamWithConcurrency } from './utils/concurrencyPool.js';
import { createRateLimiter } from './utils/rateLimiter.js';
import { initBranding, refreshClientUsage, getClientSlug, getClientToken, getClientBranding } from './branding.js';

// White-label фасад для клиентских пилотов (?client=slug в URL) — см. branding.js.
// Не блокирует остальную инициализацию: fail-open при сбое сети.
initBranding();
initFeedback(); // не зависит от branding/клиента — кнопка видна всегда, см. feedback.js

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
const includeTextCheckbox = document.getElementById('includeTextCheckbox');
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
initTranslation({ getFileGroups });

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
  includeTextCheckbox.disabled = true;
}

function unlockControls() {
  recognizeBtn.disabled = false;
  setControlsDisabled(false);
  langSelect.querySelectorAll('input').forEach(el => el.disabled = false);
  modeSelect.querySelectorAll('input').forEach(el => el.disabled = false);
  postProcessCheckbox.disabled = false;
  includeTextCheckbox.disabled = false;
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
// (пользователь оставил «Определить автоматически») и результат классификации
// оказался табличным типом (накладная, справочник номенклатуры и т.д.) — сервер
// сам делает внутренний дозапрос за строками таблицы уже с известным типом, ВНУТРИ
// одного HTTP-запроса (см. lib/recognize.js:recognizeDocument). Раньше (до 9 сен
// 2026, "закрытие дыры с skipOcr") это было отдельным вторым HTTP-запросом ПРЯМО
// ОТСЮДА, с параметром skipOcr:true — из-за того, что этот параметр был виден и
// управляем снаружи, тот же приём мог применить кто угодно к самому API напрямую
// и получить страницу бесплатно, минуя лимит. Теперь клиент делает один запрос на
// страницу всегда, независимо от того, табличный тип или нет — сам механизм ему
// не виден и не подконтролен.
async function recognizePage(pageImage, mode, lang, presetType, signal, onStatus) {
  if (mode === 'gemini') {
    const onRetry = ({ attempt, maxAttempts, delayMs, status }) => {
      const sec = Math.ceil(delayMs / 1000);
      // HTTP-статус сам по себе не указывает, какой именно сервис недоступен.
      const reason = status === 429 ? 'Превышен лимит запросов' : 'Сервис распознавания временно недоступен';
      onStatus(`${reason}, ждём ${sec} сек… (попытка ${attempt}/${maxAttempts})`);
    };
    const clientSlug = getClientSlug(); // white-label пилот (?client=slug) — см. branding.js
    const clientToken = getClientToken(); // токен гейта паролем, если у клиента он задан — см. branding.js
    await geminiRateLimiter.acquire(signal);
    // includeTextCheckbox — "Настройки распознавания" (Ethan, 9 сен 2026: "что
    // если человеку не нужен полный текст"), читаем ЗДЕСЬ (не параметром функции)
    // — тот же приём, что и postProcessCheckbox выше в этом файле. false — только
    // если человек сам явно снял галочку (по умолчанию включена, см. index.html).
    const includeText = includeTextCheckbox.checked;
    const result = await recognizeWithGemini(pageImage, presetType, { onRetry, signal, clientSlug, clientToken, includeText });
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
  // Ethan, 8 сен 2026: реальный случай — объединил лицевую и обратную сторону
  // техпаспорта автомобиля в один документ (см. fileList.js:groupSelectedFiles),
  // но марка/цвет (только на обратной стороне) не попали в результат. Раньше
  // здесь брались ЦЕЛИКОМ поля с ПЕРВОЙ подходящей страницы — разумно для
  // "статья на 5 страниц, шапка только на первой", но неверно для документов,
  // где разные поля физически расположены на РАЗНЫХ страницах (техпаспорт —
  // лицевая: владелец/номер регистрации, обратная: марка/цвет/VIN/год).
  // Теперь — объединение ПО КАЖДОМУ ПОЛЮ (по label) со всех страниц: если
  // поле с таким названием уже найдено с непустым значением на более ранней
  // странице — оставляем его; если оно там было пустым (модель не смогла
  // прочитать на той конкретной странице) — берём непустое значение с другой
  // страницы, если оно там нашлось.
  let fileFieldsMap = null; // Map<label, {label, value, confidence}>
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
    if (rec.fields) {
      if (!fileFieldsMap) fileFieldsMap = new Map();
      for (const f of rec.fields) {
        const existing = fileFieldsMap.get(f.label);
        if (!existing || (!existing.value && f.value)) fileFieldsMap.set(f.label, f);
      }
    }
    if (fileItems === null && rec.items) { fileItems = rec.items; fileColumns = rec.columns || null; fileColumnKeys = rec.columnKeys || null; }
    fileConfidence = minConfidence(fileConfidence, rec.confidence);
  }
  const fileFields = fileFieldsMap ? Array.from(fileFieldsMap.values()) : null;

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
    // fileFields имеет приоритет ВСЕГДА, включая табличные типы (Ethan, 9 сен
    // 2026, "НДС стоит, но не распознаётся") — раньше здесь стояло безусловное
    // "isTableType(fileDocType) ? [] : ...", написанное ДО фичи totals, когда
    // табличные типы действительно никогда не получали fields от Gemini. Теперь
    // Счёт-фактура/Накладная/Акт МОГУТ вернуть fields (блок итогов НДС, см.
    // lib/docSchema.js:totalsForType) — эта строка тихо обнуляла их, даже когда
    // сервер уже прислал верные данные. extractFieldsHeuristic (офлайн-эвристика)
    // всё ещё не умеет табличные типы — для них при отсутствии fileFields
    // (офлайн-режим/тип без totals) остаётся [], как и раньше.
    fields = fileFields || (isTableType(fileDocType) ? [] : extractFieldsHeuristic(joinedText, fileDocType));
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

  const fileEntries = new Array(selectedFiles.length).fill(null);
  let totalTasks = 0;
  let doneCount = 0;
  let errorCount = 0;
  let failedFiles = 0;
  let preparing = true;
  let hideCompletedInitialized = false;
  recognizeBtn.textContent = 'Распознаём…';
  const updateProgress = () => {
    setProgressSummary(doneCount, errorCount, totalTasks, preparing);
    // Weight by file so discovering another PDF cannot move the bar backwards.
    const completedFiles = fileEntries.reduce((sum, entry) =>
      sum + (entry && entry.pageTexts.length ? entry.completed / entry.pageTexts.length : 0), failedFiles);
    setOverallProgress(Math.min(preparing ? 0.99 : 1, completedFiles / selectedFiles.length));
    if (totalTasks > 20 && !hideCompletedInitialized) {
      setDefaultHideCompleted(true);
      hideCompletedInitialized = true;
    }
  };
  updateProgress();
  const { concurrency: effectiveConcurrency, rpmBudget: effectiveRpmBudget } = computeEffectiveLimits();
  geminiRateLimiter = createRateLimiter(effectiveRpmBudget, 60000);

  async function* pageTasks() {
    try {
      for (let fileIndex = 0; fileIndex < selectedFiles.length && !cancelled; fileIndex++) {
        const file = selectedFiles[fileIndex];
        const pagesWrap = createFileProgressGroup(fileIndex, file.name);
        const entry = {
          file,
          presetType: selectedDocTypes[fileIndex] && selectedDocTypes[fileIndex] !== 'auto' ? selectedDocTypes[fileIndex] : null,
          pageTexts: [], pageRecognized: [], settled: [], completed: 0
        };
        fileEntries[fileIndex] = entry;
        try {
          for await (const page of iterateFilePages(file, {
            signal: abortController.signal,
            onPageCount: count => {
              entry.pageTexts = new Array(count).fill('');
              entry.pageRecognized = new Array(count).fill(null);
              entry.settled = new Array(count).fill(false);
              totalTasks += count;
              addPageRows(pagesWrap, fileIndex, count);
              updateProgress();
            }
          })) {
            yield { ...page, fileIndex };
          }
        } catch (error) {
          if (!cancelled) {
            showFileOpenError(pagesWrap);
            if (!entry.pageTexts.length) {
              fileEntries[fileIndex] = null;
              failedFiles++;
            }
          }
        }
      }
    } finally {
      preparing = false;
      updateProgress();
    }
  }

  await runStreamWithConcurrency(pageTasks(), mode === 'gemini' ? effectiveConcurrency : 1, async task => {
    const { fileIndex, pageIndex, image, error } = task;
    const entry = fileEntries[fileIndex];
    setPageStatus(fileIndex, pageIndex, 'Распознаём…');
    try {
      if (error) throw error;
      const { rawText, docType, fields, items, columns, columnKeys, confidence } = await recognizePage(
        image, mode, lang, entry.presetType,
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
    } finally {
      releasePageImage(image);
      task.image = null;
      entry.settled[pageIndex] = true;
      entry.completed++;
      updateProgress();
    }
  }, () => cancelled, task => releasePageImage(task.image));

  // Mark discovered pages that were never started (cancellation or source failure).
  fileEntries.forEach((entry, fileIndex) => {
    if (!entry) return;
    entry.settled.forEach((settled, pageIndex) => {
      if (!settled) {
        markPageError(fileIndex, pageIndex, cancelled ? 'Отменено' : 'Не удалось подготовить страницу');
        errorCount++;
      }
    });
  });
  setProgressSummary(doneCount, errorCount, totalTasks);

  // Фаза 3: сборка финального результата по каждому файлу — без сети, детерминированно
  // (см. комментарий в finalizeFileResult про порядок страниц, а не порядок завершения запросов).
  const fileResults = [];
  for (const entry of fileEntries) {
    if (entry) fileResults.push(finalizeFileResult(entry, mode));
  }

  finishProgress(cancelled);
  void refreshClientUsage();

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
