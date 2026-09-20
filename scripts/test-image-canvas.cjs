// Регрессия: <img> с отозванным blob-URL нельзя отдавать в Tesseract.js —
// он падает внутри (net::ERR_FILE_NOT_FOUND, "e.toBlob is not a function"), и
// распознавание/проверка поворота не завершается никогда (Ethan, 20 сен 2026,
// живой кейс: JPG зависали на "Распознаём…"). public/js/ocr/imageCanvas.js
// превращает кадр страницы в canvas. Проверяем логику без браузера — на
// подмене document/HTMLCanvasElement.
const { test } = require('node:test');
const assert = require('node:assert/strict');

class FakeCanvas {
  constructor() { this.width = 0; this.height = 0; this.draws = []; }
  getContext() { return { drawImage: (...args) => this.draws.push(args) }; }
}

async function withDom(fn) {
  const saved = { document: global.document, HTMLCanvasElement: global.HTMLCanvasElement };
  global.HTMLCanvasElement = FakeCanvas;
  global.document = { createElement: tag => { assert.equal(tag, 'canvas'); return new FakeCanvas(); } };
  try { return await fn(await import('../public/js/ocr/imageCanvas.js')); } finally { Object.assign(global, saved); }
}

test('an <img> becomes a canvas of its natural size; release frees it', async () => {
  await withDom(({ pageToCanvas }) => {
    const img = { naturalWidth: 3000, naturalHeight: 2000 };
    const { canvas, release } = pageToCanvas(img);
    assert.ok(canvas instanceof FakeCanvas && canvas.width === 3000 && canvas.height === 2000);
    assert.equal(canvas.draws.length, 1);
    assert.equal(canvas.draws[0][0], img);
    release();
    assert.equal(canvas.width, 0);
  });
});

test('maxSide scales a large image down (never up) keeping proportions', async () => {
  await withDom(({ pageToCanvas }) => {
    const big = pageToCanvas({ naturalWidth: 4000, naturalHeight: 3000 }, 2500).canvas;
    assert.deepEqual([big.width, big.height], [2500, 1875]);
    const small = pageToCanvas({ naturalWidth: 800, naturalHeight: 600 }, 2500).canvas;
    assert.deepEqual([small.width, small.height], [800, 600]);
  });
});

test('a canvas within the limit is passed through untouched; release does not free the caller\'s canvas', async () => {
  await withDom(({ pageToCanvas }) => {
    const source = new FakeCanvas(); source.width = 1000; source.height = 800;
    const { canvas, release } = pageToCanvas(source, 2500);
    assert.equal(canvas, source);
    release();
    assert.equal(source.width, 1000);
  });
});
