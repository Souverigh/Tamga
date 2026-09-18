// Local fixture: real panel/export code, synthetic document and local API stubs.
// Run: node scripts/translation-tables-browser.cjs, then open localhost:4179.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../public');
const fixture = {
  doc_type: 'Аттестат', fields: [{ key: 'institution', label: 'Учебное заведение', value: 'Школа', translated: 'School', confidence: 95 }],
  paragraphs: [{ text: 'Дополнительная отметка', translated: 'Additional note' }],
  tables: [
    { section: 'Предметы и оценки', rows: [
      { subject: 'Биология', grade: '5', translatedSubject: 'Biology', translatedGrade: '5' },
      { subject: 'География', grade: '4', translatedSubject: 'Geography', translatedGrade: '4' },
      { subject: 'Очень длинное название предмета: история и культура народов Центральной Азии', grade: '', translatedSubject: 'A very long subject name: history and culture of the peoples of Central Asia', translatedGrade: '' }
    ] },
    { section: 'Итоговые экзамены и оценки', rows: [{ subject: 'Биология', grade: '4', translatedSubject: 'Biology', translatedGrade: '4' }] }
  ]
};
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/accounting.css"><link rel="stylesheet" href="/css/translation.css">
<body><pre id="checks">RUNNING</pre><main style="max-width:1100px;margin:auto"><div id="recognizeFlow"></div></main>
<script type="importmap">{"imports":{"https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs":"/pdf-stub.mjs"}}</script>
<script type="module">
const status = document.querySelector('#checks');
window.addEventListener('unhandledrejection', e => { status.textContent = 'FAIL: ' + e.reason.stack; });
const { initTranslationDocs } = await import('/js/translationDocs/panel.js');
await initTranslationDocs();
document.querySelectorAll('[role=tab]')[1].click();
const dt = new DataTransfer();
dt.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrWQAAAAASUVORK5CYII='), c=>c.charCodeAt(0))], 'school.png', {type:'image/png'}));
const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change'));
await new Promise(r => setTimeout(r, 100));
[...document.querySelectorAll('button')].find(b=>b.textContent === 'Перевести').click();
await new Promise(r => setTimeout(r, 500));
if (!status.textContent.startsWith('FAIL')) {
  const rows = [...document.querySelectorAll('#translationDocsPanel tr')].map(r=>[...r.cells].map(c=>c.textContent));
  const old = new URLSearchParams(location.search).has('old');
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  try {
    assert(old || rows.some(r=>r.join('|') === 'Биология|5|Biology|5'), 'Biology row missing or shifted');
    assert(old || rows.some(r=>r.join('|') === 'География|4|Geography|4'), 'Geography row missing or shifted');
    assert(rows.some(r=>r.includes('Additional note')), 'paragraph missing');
    const { buildExportDocs } = await import('/js/translationDocs/export-model.mjs');
    const { downloadTranslationPdf } = await import('/js/translation/export.mjs');
    const result = await (await fetch('/api/translation-docs/client-recognize'+(old?'?old':''))).json();
    const { translation } = buildExportDocs({file:{name:'school.png'},result},'en');
    // Capture the actual DOM submitted to the rasterizer, not a separate print builder.
    window.html2canvas = async node => {
      assert(old || node.textContent.includes('Biology'), 'direct PDF omits subject tables');
      assert(node.textContent.includes('Additional note'), 'direct PDF omits paragraphs');
      assert(old || node.textContent.includes('Итоговые экзамены и оценки'), 'direct PDF omits section heading');
      const canvas = document.createElement('canvas'); canvas.width=720; canvas.height=100; return canvas;
    };
    window.jspdf = { jsPDF: class { addImage() {} addPage() {} save() {} } };
    await downloadTranslationPdf(translation);
    status.textContent = 'PASS: panel rows, blank grade, sections, paragraphs and direct PDF input';
  } catch (e) { status.textContent = 'FAIL: '+e.stack; }
}
</script>`;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(html); }
  if (url.pathname === '/mobile') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end('<iframe title="Mobile 390px" src="/" style="width:390px;height:2200px;border:1px solid"></iframe>'); }
  if (url.pathname === '/api/client-settings') { res.setHeader('Content-Type','application/json'); return res.end('{}'); }
  if (url.pathname === '/api/translation-docs/client-recognize') {
    res.setHeader('Content-Type','application/json');
    const old = url.searchParams.has('old') || (req.headers.referer || '').includes('?old');
    return res.end(JSON.stringify(old ? {...fixture, doc_type:'Другое', tables:undefined} : fixture));
  }
  res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
  if (url.pathname === '/js/branding.js') return res.end('export const getClientSlug=()=>"fixture"; export const getClientToken=()=>"fixture"; export const getClientBranding=()=>({});');
  if (url.pathname === '/pdf-stub.mjs') return res.end('export const GlobalWorkerOptions={};');
  const file = path.resolve(root, '.'+url.pathname);
  if (!file.startsWith(root+path.sep)) { res.statusCode=403; return res.end(); }
  fs.readFile(file, (err, content) => { if(err) {res.statusCode=404; return res.end();} res.end(content); });
}).listen(4179, '127.0.0.1', () => console.log('Translation fixture: http://127.0.0.1:4179'));
