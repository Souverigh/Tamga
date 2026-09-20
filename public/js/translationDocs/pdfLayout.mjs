// public/js/translationDocs/pdfLayout.mjs — чистая (без pdf.js/pdf-lib/DOM)
// геометрия для перевода текстового PDF "на месте" (Ethan, 20 сен 2026: "если
// в PDF есть текст, переводим как есть, не меняя структуру"). Здесь только
// то, что можно проверить в Node без браузера: склейка фрагментов текста
// страницы в блоки, выбор, что переводить, подгонка перевода в исходный
// прямоугольник. Всё, что касается самих PDF-файлов и шрифтов, — в
// pdfInPlace.mjs.
//
// Системы координат — как в PDF: начало внизу слева, y растёт вверх, y
// фрагмента — его БАЗОВАЯ линия (baseline).

const TERMINAL_PUNCT = /[.:;!?…]$/;
const CJK = /[㐀-鿿豈-﫿　-〿＀-￯]/;
// Границы прямоугольника, закрывающего исходную строку, — доли размера
// шрифта над/под базовой линией (см. coverRects). Верх с запасом: у "Й"/"Ё"
// скобка и точки выше заглавной буквы (~0.95 кегля), иначе они торчат из-под
// перевода. В таблице с шагом строк 1.48 кегля прямоугольник всё равно
// остаётся внутри ячейки.
const ASCENT = 0.98;
const DESCENT = 0.28;

// Есть ли в строке что переводить: хотя бы одна буква и это не просто
// номер/дата/числовой идентификатор ("2006-09-20", "26471520805", "№ 5") и
// не ссылка/почта. Числа и идентификаторы оставляем как есть — как и в
// остальном модуле "Перевод" они не должны уходить в модель.
export function isTranslatable(text) {
  const t = String(text || '').trim();
  if (!/\p{L}/u.test(t)) return false;
  if (/^[\d\s\-.,:;/+()№#%]+$/.test(t)) return false;
  if (/^(https?:\/\/|www\.)\S+$/i.test(t) || /^\S+@\S+\.\S+$/.test(t)) return false;
  return true;
}

// items: [{ str, x, y, width, size, bold }] — горизонтальные текстовые
// фрагменты страницы (y — базовая линия). page: { width, height }.
// Возвращает блоки: { text, x, right, size, bold, lines: [{ x, right, y }],
// pitch, anchor, maxWidth, center }.
export function buildBlocks(items, page) {
  const clean = items
    .filter(item => item && typeof item.str === 'string' && item.str.trim() && item.size > 0
      && [item.x, item.y, item.width].every(Number.isFinite))
    .sort((a, b) => b.y - a.y);

  // 1) строки: фрагменты с одной базовой линией (с допуском на дрожание).
  const rows = [];
  for (const item of clean) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - item.y) <= 0.3 * Math.min(row.size, item.size)) row.items.push(item);
    else rows.push({ y: item.y, size: item.size, items: [item] });
  }

  // 2) внутри строки — "прогоны": фрагменты, идущие подряд без широкого
  // разрыва. Широкий разрыв (> 1.2 кегля) — это уже другая ячейка таблицы
  // или подпись/значение, склеивать их в одну фразу нельзя.
  const runs = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let run = null;
    for (const item of row.items) {
      const gap = run ? item.x - run.right : 0;
      if (!run || gap > 1.2 * Math.max(run.size, item.size)) {
        run = { text: '', x: item.x, right: item.x, y: item.y, size: item.size, bold: false, boldChars: 0, chars: 0, dominantChars: 0 };
        runs.push(run);
      }
      const needSpace = run.text && gap > 0.12 * item.size && !/\s$/.test(run.text) && !/^\s/.test(item.str);
      run.text += (needSpace ? ' ' : '') + item.str;
      run.right = Math.max(run.right, item.x + item.width);
      const chars = item.str.trim().length;
      run.chars += chars;
      if (item.bold) run.boldChars += chars;
      if (chars > run.dominantChars) { run.size = item.size; run.dominantChars = chars; }
    }
  }
  runs.forEach(run => {
    run.text = run.text.replace(/\s+/g, ' ').trim();
    run.bold = run.boldChars > run.chars / 2;
  });

  // 3) абзацы: следующая строка продолжает предыдущую, если она сразу под
  // ней (шаг строк как внутри абзаца), с тем же кеглем/начертанием и
  // выравниванием, а предыдущая не заканчивается знаком конца фразы. Ширину
  // строки (дошла ли до края) сознательно не учитываем: реальные абзацы
  // переносятся и в узкой колонке ("Документ сформирован / Государственным
  // порталом … Кыргызской / Республики").
  const blocks = [];
  const open = [];
  for (const run of runs) {
    let target = null;
    for (const block of open) {
      const last = block.lines[block.lines.length - 1];
      const gapY = last.y - run.y;
      // Шаг строк внутри абзаца ≈ 1.15 кегля, между строками таблицы и между
      // подписью и значением под ней ≥ 1.27 (реальная распечатка "Тундук":
      // абзац 1.15, ФИО→ПИН 1.27, строки таблицы 1.48) — порог посередине.
      if (gapY <= 0 || gapY > 1.22 * Math.max(block.size, run.size)) continue;
      if (Math.abs(block.size - run.size) > 0.6 || block.bold !== run.bold) continue;
      // выравнивание: по левому краю или по центру (центрированный абзац —
      // строки разной длины с общим центром)
      const leftAligned = Math.abs(last.x - run.x) <= 3;
      const centered = !leftAligned && Math.abs((last.x + last.right) / 2 - (run.x + run.right) / 2) <= 2;
      if (!leftAligned && !centered) continue;
      const prevText = block.parts[block.parts.length - 1];
      // число/идентификатор не продолжают фразу и сами не продолжаются
      if (TERMINAL_PUNCT.test(prevText) || !isTranslatable(prevText) || !isTranslatable(run.text)) continue;
      target = block;
      break;
    }
    if (target) {
      target.lines.push({ x: run.x, right: run.right, y: run.y });
      target.parts.push(run.text);
    } else {
      const block = { parts: [run.text], lines: [{ x: run.x, right: run.right, y: run.y }], size: run.size, bold: run.bold };
      blocks.push(block);
      open.push(block);
    }
    // блок "закрыт", когда ниже него уже не может быть продолжения
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const last = open[i].lines[open[i].lines.length - 1];
      if (last.y - run.y > 3 * open[i].size) open.splice(i, 1);
    }
  }

  blocks.forEach(block => {
    block.text = block.parts.join(' ');
    delete block.parts;
    block.x = Math.min(...block.lines.map(l => l.x));
    block.right = Math.max(...block.lines.map(l => l.right));
    block.pitch = block.lines.length > 1 ? block.lines[0].y - block.lines[1].y : null;
    // многострочный блок с общим центром и разными левыми краями — центрированный
    const centers = block.lines.map(l => (l.x + l.right) / 2);
    block.centeredLines = block.lines.length > 1 && Math.max(...centers) - Math.min(...centers) <= 2
      && block.lines.some(l => Math.abs(l.x - block.lines[0].x) > 3);
  });

  assignAnchors(blocks, page);
  return blocks;
}

// Выравнивание и доступная ширина каждого блока — по соседям в той же строке.
function assignAnchors(blocks, page) {
  const contentMin = Math.min(...blocks.map(b => b.x), page.width);
  const contentMax = Math.max(...blocks.map(b => b.right), 0);
  // соседи по строке — блоки, чей вертикальный диапазон пересекается с
  // диапазоном этого блока (первые строки могут стоять на разной высоте:
  // подпись из двух строк рядом со значением из трёх)
  const extent = b => [b.lines[b.lines.length - 1].y - DESCENT * b.size, b.lines[0].y + ASCENT * b.size];
  const sameRow = (a, b) => {
    const [aLow, aHigh] = extent(a), [bLow, bHigh] = extent(b);
    return Math.min(aHigh, bHigh) - Math.max(aLow, bLow) > 0.3 * Math.min(a.size, b.size);
  };
  blocks.forEach(block => {
    const peers = blocks.filter(other => other !== block && sameRow(block, other));
    const left = peers.filter(o => o.right <= block.x + 2).sort((a, b) => b.right - a.right)[0];
    const right = peers.filter(o => o.x >= block.right - 2).sort((a, b) => a.x - b.x)[0];
    const pad = 0.5 * block.size;
    const width = block.right - block.x;
    const center = (block.x + block.right) / 2;
    // строка из трёх и более ячеек — строка таблицы: значения в ячейках,
    // как правило, выровнены по центру ячейки, а не по левому краю.
    const tableRow = peers.length >= 2 && (left || right);
    if (block.centeredLines) {
      block.anchor = 'center';
      block.center = (block.lines[0].x + block.lines[0].right) / 2;
      block.maxWidth = width;
    } else if (!left && !right && block.lines.length === 1 && Math.abs(center - page.width / 2) <= 6) {
      block.anchor = 'center';
      block.center = center;
      block.maxWidth = Math.max(width, 2 * Math.min(center - contentMin, contentMax - center));
    } else if (tableRow) {
      const lo = left ? left.right + pad : contentMin;
      const hi = right ? right.x - pad : contentMax;
      block.anchor = 'center';
      block.center = center;
      // ширину ячейки мы не знаем (границы — векторные линии), поэтому
      // не даём тексту разрастись сильно больше исходного
      block.maxWidth = Math.max(width, Math.min(2 * Math.min(center - lo, hi - center), Math.max(width * 1.6, width + 16)));
    } else {
      block.anchor = 'left';
      const hi = right ? right.x - pad : contentMax;
      // Многострочный блок сохраняет исходную ширину колонки: справа от него
      // может быть не текст, а картинка (QR-код, печать), которой мы не
      // видим. Разрастаться вправо разрешаем только однострочному блоку.
      block.maxWidth = block.lines.length > 1 ? width : Math.max(width, hi - block.x);
    }
  });
}

// Разбивает текст на строки не шире maxWidth. measure(str) — ширина строки
// в пунктах при уже выбранном кегле. Китайский/японский текст переносится
// по символам, остальные — по словам (слишком длинное слово ломается по
// символам).
export function wrapText(text, measure, maxWidth) {
  const tokens = [];
  String(text).replace(/\s+/g, ' ').trim().split(' ').forEach(word => {
    if (!word) return;
    if (CJK.test(word)) Array.from(word).forEach(ch => tokens.push({ text: ch, glue: true }));
    else tokens.push({ text: word, glue: false });
  });
  const lines = [];
  let current = '';
  const push = () => { if (current) lines.push(current); current = ''; };
  for (const token of tokens) {
    const joiner = current && !token.glue ? ' ' : '';
    if (measure(current + joiner + token.text) <= maxWidth) { current += joiner + token.text; continue; }
    push();
    if (measure(token.text) <= maxWidth) { current = token.text; continue; }
    // одно слово шире строки — режем по символам
    for (const ch of Array.from(token.text)) {
      if (current && measure(current + ch) > maxWidth) push();
      current += ch;
    }
  }
  push();
  return lines;
}

// Подбирает кегль и разбивку перевода на строки. Сначала пытается уложить
// перевод в исходное число строк, уменьшая кегль (не ниже 62% исходного);
// если не выходит — оставляет чуть меньший кегль и позволяет тексту занять
// лишние строки ниже блока (лучше, чем нечитаемо мелкий шрифт).
// measure(str, size) — ширина строки при кегле size.
export function fitBlock(block, translated, measure) {
  const origLines = block.lines.length;
  const attempt = scale => {
    const size = block.size * scale;
    return { size, lines: wrapText(translated, str => measure(str, size), block.maxWidth) };
  };
  for (let scale = 1; scale >= 0.62; scale -= 0.04) {
    const fit = attempt(scale);
    if (fit.lines.length <= origLines) return fit;
  }
  return attempt(0.75);
}

// Прямоугольники, закрывающие исходный текст блока (по одному на строку).
export function coverRects(block) {
  return block.lines.map(line => ({
    x: line.x - 1.5,
    y: line.y - DESCENT * block.size,
    width: line.right - line.x + 3,
    height: (ASCENT + DESCENT) * block.size
  }));
}

// Позиции строк перевода: [{ text, x, y }]. width(str) — ширина при уже
// подобранном кегле fit.size.
export function placeLines(block, fit, width) {
  const pitch = Math.max(fit.size * 1.1, (block.pitch || block.size * 1.2) * (fit.size / block.size));
  return fit.lines.map((text, index) => {
    const w = width(text);
    return {
      text,
      x: block.anchor === 'center' ? block.center - w / 2 : block.x,
      y: block.lines[0].y - index * pitch
    };
  });
}
