const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(path, globals = {}) {
  const context = vm.createContext({ setTimeout, clearTimeout, ...globals });
  if (path.endsWith('pdfLoader.js')) vm.runInContext(fs.readFileSync('public/js/utils/fileSafety.js', 'utf8').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync(path, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), context);
  return context;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('stream overlaps preparation with recognition and bounds retained pages', async () => {
  const { runStreamWithConcurrency } = load('public/js/utils/concurrencyPool.js');
  let prepared = 0, active = 0, peak = 0;
  const releases = [];
  const results = [];
  async function* pages() {
    for (let i = 0; i < 6; i++) { prepared++; yield i; }
  }
  const running = runStreamWithConcurrency(pages(), 2, async i => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => { releases[i] = resolve; });
    results[i] = i;
    active--;
  });
  await tick();
  assert.equal(active, 2);
  assert.equal(prepared, 3, 'only one prepared page may wait for capacity');
  releases[1](); // second page finishes first
  await tick();
  assert.equal(prepared, 4);
  releases[0](); releases[2]();
  await tick();
  releases[3](); releases[4]();
  await tick();
  releases[5]();
  await running;
  assert.equal(peak, 2);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
});

test('cancellation disposes the waiting page and closes the source', async () => {
  const { runStreamWithConcurrency } = load('public/js/utils/concurrencyPool.js');
  let cancelled = false, closed = false, release;
  const started = [], disposed = [];
  async function* pages() {
    try { yield 0; yield 1; yield 2; } finally { closed = true; }
  }
  const running = runStreamWithConcurrency(pages(), 1, async i => {
    started.push(i);
    await new Promise(resolve => { release = resolve; });
  }, () => cancelled, i => disposed.push(i));
  await tick();
  cancelled = true;
  release();
  await running;
  assert.deepEqual(started, [0]);
  assert.deepEqual(disposed, [1]);
  assert.equal(closed, true);
});

test('source errors still drain active recognition before returning', async () => {
  const { runStreamWithConcurrency } = load('public/js/utils/concurrencyPool.js');
  let release, finished = false;
  async function* pages() { yield 0; throw new Error('source failed'); }
  const running = runStreamWithConcurrency(pages(), 2, async () => {
    await new Promise(resolve => { release = resolve; });
    finished = true;
  });
  const rejected = assert.rejects(running, /source failed/);
  await tick();
  assert.equal(finished, false);
  release();
  await rejected;
  assert.equal(finished, true);
});

test('PDF streams the first page before rendering the second and destroys its resources', async () => {
  const rendered = [], counts = [];
  let destroyed = false;
  const { iteratePdfPages } = load('public/js/ocr/pdfLoader.js', {
    document: { createElement: () => ({ getContext: () => ({}) }) },
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({
      promise: Promise.resolve({ numPages: 25, getPage: async i => ({
        getViewport: () => ({ width: 100, height: 200 }),
        render: () => { rendered.push(i); return { promise: Promise.resolve(), cancel() {} }; },
        cleanup() {}
      }) }),
      destroy: async () => { destroyed = true; }
    }) }
  });
  const source = iteratePdfPages({ size: 1, arrayBuffer: async () => new ArrayBuffer(1) }, { onPageCount: n => counts.push(n) });
  const first = await source.next();
  assert.equal(first.value.pageIndex, 0);
  assert.deepEqual(rendered, [1]);
  assert.deepEqual(counts, [20]);
  await source.return();
  assert.equal(destroyed, true);
});

test('a broken PDF page does not discard its neighbours', async () => {
  const { iteratePdfPages } = load('public/js/ocr/pdfLoader.js', {
    document: { createElement: () => ({ getContext: () => ({}) }) },
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({
      promise: Promise.resolve({ numPages: 3, getPage: async i => ({
        getViewport: () => ({ width: 10, height: 20 }),
        render: () => ({ promise: i === 2 ? Promise.reject(new Error('bad page')) : Promise.resolve() }),
        cleanup() {}
      }) }), destroy: async () => {}
    }) }
  });
  const pages = [];
  for await (const page of iteratePdfPages({ size: 1, arrayBuffer: async () => new ArrayBuffer(1) })) pages.push(page);
  assert.equal(pages.length, 3);
  assert.ok(pages[0].image);
  assert.match(pages[1].error.message, /bad page/);
  assert.ok(pages[2].image);
});

test('aborting PDF rendering cancels it and clears the canvas', async () => {
  const controller = new AbortController();
  let rejectRender, cancelled = false, destroyed = false;
  const canvas = { getContext: () => ({}) };
  const { iteratePdfPages } = load('public/js/ocr/pdfLoader.js', {
    document: { createElement: () => canvas },
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({
      promise: Promise.resolve({ numPages: 2, getPage: async () => ({
        getViewport: () => ({ width: 10, height: 20 }),
        render: () => ({ promise: new Promise((_, reject) => { rejectRender = reject; }),
          cancel: () => { cancelled = true; rejectRender(new Error('cancelled')); } }),
        cleanup() {}
      }) }), destroy: async () => { destroyed = true; }
    }) }
  });
  const source = iteratePdfPages({ size: 1, arrayBuffer: async () => new ArrayBuffer(1) }, { signal: controller.signal });
  const pending = source.next();
  await tick();
  controller.abort();
  assert.equal((await pending).done, true);
  assert.equal(canvas.width, 0);
  assert.equal(cancelled, true);
  assert.equal(destroyed, true);
});

test('grouped images load lazily in order and continue past a failed image', async () => {
  const opened = [], counts = [];
  const { iterateFilePages } = load('public/js/ocr/pageSource.js', {
    loadImageFile: async file => {
      opened.push(file);
      if (file === 'bad') throw new Error('bad image');
      return [{ src: file }];
    }
  });
  const source = iterateFilePages({ __group: true, files: ['first', 'bad', 'last'] }, { onPageCount: n => counts.push(n) });
  assert.equal((await source.next()).value.image.src, 'first');
  assert.deepEqual(opened, ['first']);
  assert.deepEqual(counts, [3]);
  assert.equal((await source.next()).value.pageIndex, 1);
  assert.equal((await source.next()).value.image.src, 'last');
  assert.equal((await source.next()).done, true);
});

test('app starts recognition during preparation and assembles results in page order', async () => {
  const { runStreamWithConcurrency } = load('public/js/utils/concurrencyPool.js');
  let click, releaseSecondPage, releaseFirstResult, saved, unlocked = false;
  const started = [], released = [], marked = [];
  const context = vm.createContext({
    AbortController,
    recognizeBtn: { addEventListener: (_, fn) => { click = fn; } },
    getSelectedFiles: () => [{ name: 'test.pdf' }], getSelectedDocTypes: () => ['auto'],
    getSelectedMode: () => 'gemini', getSelectedLang: () => 'rus', isTableType: () => false,
    restoreBanner: { style: {} }, lockControls() {}, unlockControls: () => { unlocked = true; },
    startProgress() {}, hideResults() {}, cancelTesseract() {},
    setProgressSummary() {}, setOverallProgress() {}, setDefaultHideCompleted() {},
    computeEffectiveLimits: () => ({ concurrency: 2, rpmBudget: 200 }), createRateLimiter: () => ({}),
    createFileProgressGroup() {}, addPageRows() {}, showFileOpenError() {},
    setPageStatus() {}, markPageDone: (_, page) => marked.push(page), markPageError() {},
    runStreamWithConcurrency,
    iterateFilePages: async function* (_, { onPageCount }) {
      onPageCount(2);
      yield { pageIndex: 0, image: { id: 0 } };
      await new Promise(resolve => { releaseSecondPage = resolve; });
      yield { pageIndex: 1, image: { id: 1 } };
    },
    recognizePage: async image => {
      started.push(image.id);
      if (image.id === 0) await new Promise(resolve => { releaseFirstResult = resolve; });
      return { rawText: `page ${image.id}`, docType: 'Справка', fields: [], confidence: 90 };
    },
    releasePageImage: image => released.push(image.id),
    postProcessText: text => text, postProcessCheckbox: { checked: true },
    finalizeFileResult: entry => ({ pages: entry.pageTexts }), finishProgress() {},
    refreshClientUsage() {}, showResults() {}, saveResultsToStorage: result => { saved = result; }
  });
  const app = fs.readFileSync('public/js/app.js', 'utf8');
  vm.runInContext(app.slice(app.indexOf("recognizeBtn.addEventListener('click'"), app.indexOf('// --- Экспорт:')), context);
  const running = click();
  await tick();
  assert.deepEqual(started, [0], 'recognition must start while the next page is still preparing');
  releaseSecondPage();
  await tick();
  assert.deepEqual(marked, [1]);
  releaseFirstResult();
  await running;
  assert.equal(saved[0].pages.join('|'), 'page 0|page 1');
  assert.deepEqual(released.sort(), [0, 1]);
  assert.equal(unlocked, true);
});
