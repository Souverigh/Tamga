// lib/translationDocs/structuralTranslate.js — серверная половина режима
// "Перевести как есть" (Ethan, 19 сен 2026). Клиент (structuralDocx.mjs)
// уже распаковал .docx и прислал сюда готовые сегменты текста по одному на
// абзац — здесь их только переводят и списывают страницу общего пакета
// клиента; сборка итогового .docx (вставка перевода обратно в оригинальную
// структуру) происходит на клиенте, там же, где файл распаковывался.
//
// Параллельный путь к recognizeAndTranslateDocument (pipeline.js) — там
// сначала классификация типа документа и извлечение ПОЛЕЙ, здесь этого нет
// вообще: вход уже готовые сегменты произвольного текста, выход — их же
// переводы с теми же id.
//
// Батчинг (по 50 сегментов / 2000 символов на запрос translateSegments,
// длинные абзацы режутся через splitText и склеиваются обратно по индексу
// чанка) — тот же приём, что уже есть в pipeline.js для свободных абзацев
// типа "Другое". Сознательно продублирован здесь, а не вынесен в общий
// хелпер — чтобы не трогать уже работающий pipeline.js.
const { consumeUsage } = require('../customFieldsLookup');
const { validateTranslationRequest, translateSegments } = require('../translation');

class StructuralTranslateError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_SEGMENTS = 2000;
const MAX_TOTAL_CHARS = 200000;
const MAX_SEGMENT_CHARS = 1800; // тот же лимит, что у paragraphsOut в pipeline.js
const SEGMENT_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

function validateSegments(rawSegments) {
  if (!Array.isArray(rawSegments) || !rawSegments.length) {
    throw new StructuralTranslateError('В документе не найдено переводимого текста.');
  }
  if (rawSegments.length > MAX_SEGMENTS) {
    throw new StructuralTranslateError('Документ слишком большой для перевода "как есть".', 413);
  }
  const ids = new Set();
  let totalChars = 0;
  const segments = rawSegments.map(s => {
    if (!s || typeof s.id !== 'string' || !SEGMENT_ID_RE.test(s.id) || ids.has(s.id) || typeof s.text !== 'string' || !s.text.trim()) {
      throw new StructuralTranslateError('Некорректные фрагменты документа.');
    }
    ids.add(s.id);
    totalChars += s.text.length;
    return { id: s.id, text: s.text };
  });
  if (totalChars > MAX_TOTAL_CHARS) {
    throw new StructuralTranslateError('Документ слишком большой для перевода "как есть".', 413);
  }
  return segments;
}

async function translateDocumentSegments({ segments: rawSegments, language, clientApiKey, clientSlug, pageCount = 1 }) {
  if (!language || typeof language !== 'string') throw new StructuralTranslateError('Поле "language" (язык перевода) обязательно');
  const segments = validateSegments(rawSegments);

  // Списываем страницу ДО перевода — тот же приём и тот же общий лимит
  // страниц пакета клиента, что у pipeline.js/recognize.js (Ethan, 16 сен
  // 2026: общий лимит вместо отдельной квоты для модуля "Перевод"). Один
  // загруженный .docx = одна страница по РАЗМЕРУ документа (baseUnits, от
  // pageCount файла, не от объёма текста) — но списывается вдвое больше
  // (units = baseUnits * 2), потому что сам перевод теперь делает два прогона
  // Gemini на сегмент — перевод и проверочный (см.
  // lib/translation.js:verifyTranslationAccuracy) — Ethan, 21 сен 2026:
  // "для переводческого будет использоваться в два раза больше лимита",
  // явно только для модуля "Перевод" — распознавание (lib/recognize.js) и
  // бухгалтерия (lib/accounting/pipeline.js) списывают как раньше, 1:1.
  if (clientApiKey || clientSlug) {
    const baseUnits = Number.isInteger(pageCount) ? Math.max(1, Math.min(50, pageCount)) : 1;
    const units = baseUnits * 2;
    for (let unit = 0; unit < units; unit += 1) {
      const usage = await consumeUsage({ apiKey: clientApiKey, clientSlug });
      if (usage.unavailable) throw new StructuralTranslateError('Учёт лимитов временно недоступен', 503, 'QUOTA_UNAVAILABLE');
      if (!usage.allowed) {
        throw new StructuralTranslateError(
          `Лимит страниц по вашему тарифу исчерпан (${usage.pagesUsed}/${usage.pageLimit}). Обратитесь к администратору для пополнения пакета.`,
          402, 'QUOTA_EXCEEDED'
        );
      }
    }
  }

  const { splitText } = await import('../../public/js/translation/model.mjs');

  // Разбиваем длинные абзацы на чанки (translateSegments отклоняет сегмент
  // длиннее общего лимита запроса), запоминаем план склейки по paragraphId.
  const chunkPlan = [];
  const toTranslate = [];
  for (const segment of segments) {
    const chunks = segment.text.length > MAX_SEGMENT_CHARS ? splitText(segment.text, MAX_SEGMENT_CHARS) : [segment.text];
    chunkPlan.push({ id: segment.id, chunkCount: chunks.length });
    chunks.forEach((chunk, chunkIndex) => toTranslate.push({ id: `${segment.id}__${chunkIndex}`, text: chunk }));
  }

  const batches = [];
  let batch = [];
  let batchSize = 0;
  for (const item of toTranslate) {
    if (batch.length && (batch.length >= 50 || batchSize + item.text.length > 2000)) {
      batches.push(batch);
      batch = [];
      batchSize = 0;
    }
    batch.push(item);
    batchSize += item.text.length;
  }
  if (batch.length) batches.push(batch);

  const usageClientRef = clientApiKey || clientSlug || null;
  const translatedChunks = new Map();
  for (const current of batches) {
    // transliterateNames: true — здесь целые абзацы .docx как есть, ФИО
    // (если есть) стоит прямо внутри текста, отдельно транслитерировать
    // некому (см. комментарий у флага в lib/translation.js).
    const request = validateTranslationRequest({ language, segments: current, transliterateNames: true });
    const { segments: translated } = await translateSegments(request, usageClientRef);
    for (const seg of translated) translatedChunks.set(seg.id, seg.text);
  }

  const result = chunkPlan.map(({ id, chunkCount }) => {
    const parts = [];
    for (let i = 0; i < chunkCount; i += 1) parts.push(translatedChunks.get(`${id}__${i}`) || '');
    return { id, text: parts.join('') };
  });

  return { segments: result };
}

module.exports = { translateDocumentSegments, StructuralTranslateError };
