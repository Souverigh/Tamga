// public/js/translationDocs/pdfInPlace.mjs — перевод текстового PDF "на
// месте" (Ethan, 20 сен 2026: "если в PDF есть текст, переводим как есть, не
// меняя структуру, когда человек скачивает PDF; Word не трогаем").
//
// Как это работает: pdf.js достаёт из каждой страницы позиционированный
// текст, pdfLayout.mjs склеивает его в блоки (абзацы/ячейки), блоки уходят
// на перевод, а потом pdf-lib рисует поверх оригинальной страницы: закрывает
// исходную строку прямоугольником цвета фона и печатает перевод в том же
// месте. Векторная графика, таблицы, логотипы, печати и фон остаются
// оригинальными — это тот самый исходный PDF, а не пересобранный по шаблону.
//
// Ограничения (осознанные): исходный текст остаётся в файле под
// закрашенным прямоугольником (виден только при копировании/поиске); текст,
// повёрнутый не горизонтально, и PDF-сканы (картинка + невидимый слой
// распознавания) не трогаем — для них возвращаем null, и вызывающий код
// уходит на прежний путь (PDF по шаблону).
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs';
import { PDFDocument, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js';
import fontkit from 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm';
import { buildBlocks, isTranslatable, fitBlock, coverRects, placeLines } from './pdfLayout.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs';

const MAX_PAGES = 50; // тот же потолок, что MAX_PAGES_PER_DOCUMENT в panel.js и baseUnits в structuralTranslate.js (Ethan, 21 сен 2026: поднято с 20)
const MIN_TRANSLATABLE_CHARS = 30;
const SAMPLE_SCALE = 2;

// Noto Sans покрывает латиницу (в т.ч. расширенную: ş ğ ä ü), кириллицу
// (в т.ч. кыргызские ң ү ө) — один файл на начертание. Для китайского
// нужен отдельный шрифт (~7 МБ, грузится только при переводе на zh).
const FONT_URLS = {
  regular: 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf',
  bold: 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf',
  zh: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf'
};
const fontCache = new Map();
async function loadFontBytes(kind) {
  if (!fontCache.has(kind)) {
    fontCache.set(kind, fetch(FONT_URLS[kind]).then(res => {
      if (!res.ok) throw new Error(`Не удалось загрузить шрифт (${res.status})`);
      return res.arrayBuffer();
    }).catch(err => { fontCache.delete(kind); throw err; }));
  }
  return fontCache.get(kind);
}

const luminance = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

// Цвет фона и цвет текста блока по отрендеренной странице. Фон — самый частый
// цвет внутри самих закрашиваемых прямоугольников (текст занимает меньшую
// часть площади; кольцо вокруг брать нельзя — в таблице там чёрные линии
// границ ячеек). Цвет текста — пиксель, сильнее всего отличающийся по яркости
// от фона. Любая неудача → белый фон, чёрный текст.
function sampleColors(ctx, canvas, viewport, rects) {
  try {
    const buckets = new Map();
    let fgCandidates = [];
    for (const r of rects) {
      const xs = [], ys = [];
      [[r.x, r.y], [r.x + r.width, r.y + r.height]].forEach(([x, y]) => {
        const [px, py] = viewport.convertToViewportPoint(x, y);
        xs.push(px); ys.push(py);
      });
      const left = Math.max(0, Math.floor(Math.min(...xs))), top = Math.max(0, Math.floor(Math.min(...ys)));
      const right = Math.min(canvas.width, Math.ceil(Math.max(...xs))), bottom = Math.min(canvas.height, Math.ceil(Math.max(...ys)));
      if (right - left < 2 || bottom - top < 2) continue;
      const { data } = ctx.getImageData(left, top, right - left, bottom - top);
      for (let i = 0; i < data.length; i += 4) {
        const px = [data[i], data[i + 1], data[i + 2]];
        const key = ((px[0] >> 4) << 8) | ((px[1] >> 4) << 4) | (px[2] >> 4);
        const bucket = buckets.get(key) || { count: 0, sum: [0, 0, 0] };
        bucket.count += 1;
        px.forEach((v, c) => { bucket.sum[c] += v; });
        buckets.set(key, bucket);
        fgCandidates.push(px);
      }
    }
    if (!buckets.size) return null;
    const top = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
    const bg = top.sum.map(v => Math.round(v / top.count));
    const bgLum = luminance(bg);
    const fg = fgCandidates.reduce((best, px) => (Math.abs(luminance(px) - bgLum) > Math.abs(luminance(best) - bgLum) ? px : best), bg);
    return { bg, fg: Math.abs(luminance(fg) - bgLum) < 40 ? (bgLum < 110 ? [255, 255, 255] : [0, 0, 0]) : fg };
  } catch (_) {
    return null;
  }
}

// Составной шрифт: китайский текст набирается CJK-шрифтом, а латиница, цифры и
// ASCII-знаки внутри него (имена, даты, "GMT+6") — Noto Sans; в CJK-шрифте
// у них растянутые интервалы. Без cjk работает как обычный одиночный шрифт.
const CJK_CHAR = /[　-〿㐀-鿿＀-￯]/;
function splitScripts(text) {
  const runs = [];
  for (const ch of Array.from(text)) {
    const cjk = CJK_CHAR.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.cjk === cjk) last.text += ch;
    else runs.push({ text: ch, cjk });
  }
  return runs;
}
function compositeFont(latin, cjk) {
  const pick = run => (run.cjk && cjk ? cjk : latin);
  return {
    widthOfTextAtSize: (text, size) => splitScripts(text).reduce((sum, run) => sum + pick(run).widthOfTextAtSize(run.text, size), 0),
    draw(page, text, { x, y, size, color }) {
      let cursor = x;
      for (const run of splitScripts(text)) {
        const font = pick(run);
        page.drawText(run.text, { x: cursor, y, size, font, color });
        cursor += font.widthOfTextAtSize(run.text, size);
      }
    }
  };
}

async function loadPdf(file) {
  const buffer = await file.arrayBuffer();
  // pdf.js забирает переданный буфер себе (detached) — отдаём копию, как в
  // ocr/pdfRotationFix.js, оригинал нужен pdf-lib.
  const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false });
  return { buffer, task, pdf: await task.promise };
}

// Достаёт блоки текста всех страниц + отрендеренные страницы для выборки
// цветов. Возвращает null, если это не текстовый PDF (скан/пустой).
async function extractPages(pdf, { render }) {
  // Длиннее предела — не переводим на месте вовсе: иначе первые MAX_PAGES
  // страниц перевелись бы, а остальные молча остались бы на исходном языке
  // (найдено полной проверкой модуля 20 сен 2026). Вызывающий код уходит на
  // прежний путь; сама панель и так не принимает файлы длиннее MAX_PAGES.
  if (pdf.numPages > MAX_PAGES) return null;
  const pageCount = pdf.numPages;
  const pages = [];
  let translatableChars = 0;
  for (let index = 1; index <= pageCount; index += 1) {
    const page = await pdf.getPage(index);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: SAMPLE_SCALE });
    const ops = await page.getOperatorList();
    // Режим отрисовки текста 3 = невидимый — так сканеры/OCR кладут слой
    // распознавания поверх картинки. Это скан, а не текстовый PDF.
    const { OPS } = pdfjsLib;
    const hasInvisibleText = ops.fnArray.some((fn, i) => fn === OPS.setTextRenderingMode && ops.argsArray[i][0] === 3);
    if (hasInvisibleText) { page.cleanup(); return null; }

    let canvas = null, ctx = null;
    if (render) {
      canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    }

    const content = await page.getTextContent();
    const fontIsBold = name => {
      try {
        const font = page.commonObjs.has(name) ? page.commonObjs.get(name) : null;
        return /bold|black|heavy|semibold|demi/i.test(String(font?.name || ''));
      } catch (_) { return false; }
    };
    const items = [];
    for (const it of content.items) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const [a, b, , , e, f] = it.transform;
      const size = Math.hypot(a, b);
      // не горизонтальный (повёрнутый/зеркальный) текст оставляем как есть
      if (!(size > 0) || a <= 0 || Math.abs(b) > 0.05 * size) continue;
      items.push({ str: it.str, x: e, y: f, width: it.width, size, bold: fontIsBold(it.fontName) });
    }
    const blocks = buildBlocks(items, { width: base.width, height: base.height })
      .filter(block => isTranslatable(block.text));
    translatableChars += blocks.reduce((sum, block) => sum + block.text.length, 0);
    pages.push({ blocks, canvas, ctx, viewport });
    page.cleanup();
  }
  return translatableChars >= MIN_TRANSLATABLE_CHARS ? pages : null;
}

// Есть ли в файле настоящий текстовый слой, который стоит переводить на
// месте. Дешёвая проверка без рендера — для решения, каким путём идти.
export async function hasTranslatableTextLayer(file) {
  const { task, pdf } = await loadPdf(file);
  try {
    return !!(await extractPages(pdf, { render: false }));
  } finally {
    await task.destroy();
  }
}

// Переводит PDF на месте. translate(segments) — функция вызывающего кода
// (запрос к серверу, квота): принимает [{ id, text }], возвращает Map или
// массив [{ id, text }] переводов. Возвращает Blob (application/pdf) или
// null, если файл — не текстовый PDF.
export async function translatePdfInPlace(file, { language, translate }) {
  const { buffer, task, pdf } = await loadPdf(file);
  try {
    const pages = await extractPages(pdf, { render: true });
    if (!pages) return null;

    const segments = [];
    pages.forEach((page, p) => page.blocks.forEach((block, b) => {
      block.id = `p${p}_b${b}`;
      segments.push({ id: block.id, text: block.text });
    }));
    const translated = new Map();
    for (const item of await translate(segments, pdf.numPages)) translated.set(item.id, item.text);

    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    doc.registerFontkit(fontkit);
    const isChinese = language === 'zh';
    // Китайский шрифт встраиваем ЦЕЛИКОМ: подрезка (subset) у fontkit для
    // CJK-шрифтов теряет глифы (проверено в Chromium на обоих вариантах —
    // CFF-OTF и TrueType), файл получается с пропавшими иероглифами.
    const latinRegular = await doc.embedFont(await loadFontBytes('regular'), { subset: true });
    const latinBold = await doc.embedFont(await loadFontBytes('bold'), { subset: true });
    const cjk = isChinese ? await doc.embedFont(await loadFontBytes('zh'), { subset: false }) : null;
    const fonts = { regular: compositeFont(latinRegular, cjk), bold: compositeFont(latinBold, cjk) };

    doc.getPages().slice(0, pages.length).forEach((pdfPage, p) => {
      const { blocks, canvas, ctx, viewport } = pages[p];
      const prepared = [];
      for (const block of blocks) {
        const text = (translated.get(block.id) || '').replace(/\s+/g, ' ').trim();
        // нет перевода → оставляем оригинал как есть, ничего не закрашивая
        if (!text) continue;
        const font = block.bold ? fonts.bold : fonts.regular;
        const measure = (str, size) => font.widthOfTextAtSize(str, size);
        const fit = fitBlock(block, text, measure);
        const covers = coverRects(block);
        const colors = sampleColors(ctx, canvas, viewport, covers) || { bg: [255, 255, 255], fg: [0, 0, 0] };
        prepared.push({ block, font, measure, fit, covers, colors });
      }
      // Сначала закрашиваем ВСЕ исходные строки страницы, и только потом
      // печатаем перевод: закраска строки заходит на соседние (запас под
      // "Й"/"Ё") и иначе стёрла бы уже напечатанные хвосты букв выше.
      for (const { covers, colors } of prepared) {
        const [r, g, b] = colors.bg.map(v => v / 255);
        covers.forEach(rect => pdfPage.drawRectangle({ ...rect, color: rgb(r, g, b), borderWidth: 0 }));
      }
      for (const { block, font, measure, fit, colors } of prepared) {
        const [r, g, b] = colors.fg.map(v => v / 255);
        placeLines(block, fit, str => measure(str, fit.size)).forEach(line => {
          font.draw(pdfPage, line.text, { x: line.x, y: line.y, size: fit.size, color: rgb(r, g, b) });
        });
      }
      if (canvas) canvas.width = canvas.height = 0;
    });

    const bytes = await doc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  } finally {
    await task.destroy();
  }
}
