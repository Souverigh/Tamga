const { test } = require('node:test');
const assert = require('node:assert/strict');

test('formatted exports separate details and full text without blank OCR lines', async()=>{
  const {buildDocumentXml,buildPrintHtml}=await import('../public/js/translation/export.mjs');
  const doc={name:'Passport',fields:[{label:'Name',value:'TEST'}],columns:[],keys:[],items:[],paragraphs:[{text:'Extra note\n\n\n'},{text:'Second note\n'}]};
  const xml=buildDocumentXml(doc,doc,false),html=buildPrintHtml(doc,doc,false);
  assert.ok(html.includes('Реквизиты'));assert.ok(html.includes('Полный текст'));
  assert.ok(xml.includes('Реквизиты'));assert.ok(xml.includes('Полный текст'));
  assert.ok(!xml.includes('<w:br/>'));
  for(const text of ['Extra note','Second note','TEST']){assert.ok(html.includes(text));assert.ok(xml.includes(text));}
});

test('starter templates match schemas and retain full source and additional fields', async () => {
  const { STARTER_TEMPLATES } = await import('../lib/translationTemplates.mjs');
  const { validateTemplate, buildDocument, applyTemplate } = await import('../public/js/translation/model.mjs');
  const { DOC_FIELDS } = require('../lib/docSchema');
  assert.equal(STARTER_TEMPLATES.length, 5);
  for (const entry of STARTER_TEMPLATES) {
    const saved = JSON.parse(require('node:fs').readFileSync(`lib/translation-templates/${entry.id}.json`, 'utf8'));
    assert.deepEqual(saved, entry.template, 'downloadable template must match built-in catalog');
    const template = validateTemplate(entry.template);
    assert.match(template.name, /Черновик/);
    assert.equal(template.language, 'en');
    assert.deepEqual(template.fields.map(f => f.source), DOC_FIELDS[template.docType]);
    const doc = buildDocument({docType:template.docType, text:'Полный текст\nДополнительная отметка '+template.matchText.join(' '), fields:[...template.fields.map(f=>({label:f.source,value:'123'})),{label:'Вне шаблона',value:'Не потерять'}]});
    const result=applyTemplate(doc,template,'en');
    assert.equal(result.applied,true);
    assert.deepEqual(result.document.paragraphs,doc.paragraphs);
    assert.equal(result.document.fields.at(-1).value,'Не потерять');
    const copy=validateTemplate(entry.template);copy.fields[0].target='Edited';
    assert.notEqual(entry.template.fields[0].target,'Edited');
  }
});

test('chunking preserves all Unicode and whitespace', async () => {
  const { splitText } = await import('../public/js/translation/model.mjs');
  const text = 'Кыргызча Өңү 😀\n\n' + 'договор 123 '.repeat(500);
  const chunks = splitText(text, 2000);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(s => s.length <= 2000));
  assert.ok(chunks.every(s => !/[\uD800-\uDBFF]$/.test(s)));
});

test('template never drops unmatched fields or full text; mismatch falls back', async () => {
  const { buildDocument, validateTemplate, applyTemplate } = await import('../public/js/translation/model.mjs');
  const source = { fileName: 'x', docType: 'Паспорт', text: 'Дополнительная отметка', fields: [{label:'ФИО',value:'Асан'},{label:'Примечание',value:'Важно'}], items: [] };
  const tpl = validateTemplate({ version:1, name:'Моя форма', docType:'Паспорт', language:'en', fields:[{source:'ФИО',target:'Name',required:true,preserve:true}] });
  const doc = buildDocument(source);
  const applied = applyTemplate(doc, tpl, 'en');
  assert.equal(applied.applied, true);
  assert.equal(applied.document.fields.length, 2);
  assert.equal(applied.document.paragraphs.map(p=>p.text).join(''), source.text);
  assert.equal(applied.document.fields[0].targetLabel, 'Name');
  assert.deepEqual(source.fields[0], {label:'ФИО',value:'Асан'});
  assert.equal(applyTemplate(buildDocument({...source, docType:'Договор'}), tpl, 'en').applied, false);
  assert.equal(applyTemplate(buildDocument({...source, fields:[]}), tpl, 'en').applied, false);
  assert.equal(applyTemplate(doc, tpl, 'de').applied, false);
  assert.equal(applyTemplate(doc,{...tpl,matchText:['Форма 2025']},'en').applied,false);
  assert.equal(applyTemplate(doc,{...tpl,matchText:['дополнительная   отметка']},'en').applied,true);
});

test('template rejects duplicates and cannot import filled personal values', async () => {
  const { validateTemplate } = await import('../public/js/translation/model.mjs');
  assert.throws(()=>validateTemplate({version:1,name:'X',docType:'X',language:'en',fields:[{source:'A',target:'B'},{source:'A',target:'C'}]}));
  const t = validateTemplate({version:1,name:'X',docType:'X',language:'en',fields:[{source:'A',target:'B',value:'SECRET'}]});
  assert.ok(!JSON.stringify(t).includes('SECRET'));
});

test('response validation rejects omissions, duplicate IDs, changed numbers and excessive output', () => {
  const { validateTranslationResponse } = require('../lib/translation');
  const source = [{id:'a',text:'Счёт 001-234: 12.50'}];
  assert.deepEqual(validateTranslationResponse(source,[{id:'a',text:'Account 001-234: 12.50'}]),[{id:'a',text:'Account 001-234: 12.50'}]);
  for (const result of [[],[{id:'b',text:'x'}],[{id:'a',text:'124'}],[{id:'a',text:'001-234: 12.50'},{id:'a',text:'x'}],[{id:'a',text:'x'.repeat(20000)}]]) assert.throws(()=>validateTranslationResponse(source,result));
});

test('requests reject unsupported languages and large payloads before calling provider', () => {
  const { validateTranslationRequest } = require('../lib/translation');
  assert.throws(()=>validateTranslationRequest({language:'bad',segments:[{id:'a',text:'x'}]}));
  assert.throws(()=>validateTranslationRequest({language:'en',segments:[{id:'a',text:'x'.repeat(2001)}]}));
  assert.throws(()=>validateTranslationRequest({language:'en',segments:[{id:'a',text:'x'},{id:'a',text:'y'}]}));
  assert.equal(validateTranslationRequest({language:'en',segments:[{id:'a',text:'Текст'}]}).language,'en');
});

test('translation preserves whitespace at chunk boundaries', () => {
  const {validateTranslationResponse}=require('../lib/translation');
  assert.equal(validateTranslationResponse([{id:'a',text:' Текст \n'}],[{id:'a',text:'Text'}])[0].text,' Text \n');
});

test('exports retain tables, extra text, Unicode and escape active markup',async()=>{
  const {buildDocument}=await import('../public/js/translation/model.mjs');
  const {buildDocumentXml,buildPrintHtml,buildTranslationTxt}=await import('../public/js/translation/export.mjs');
  const doc=buildDocument({fileName:'<script>x</script>',text:'Өңү & 中文',fields:[{label:'A',value:'<img onerror=alert(1)>'}],columns:['Товар','Цена'],columnKeys:['name','price'],items:[{name:'Китеп',price:'123'}]});
  const xml=buildDocumentXml(doc,doc,true);
  assert.ok(xml.includes('<w:tbl>'));assert.ok(xml.includes('Өңү &amp; 中文'));assert.ok(!xml.includes('<img '));
  const html=buildPrintHtml(doc,doc,true);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img '));assert.ok(html.includes('<table>'));
  // paired=true now merges original+translation into one bilingual table
  // (side by side) instead of two stacked documents — nothing dropped, just
  // laid out as one document instead of two.
  assert.ok(buildTranslationTxt(doc,doc,true).includes('Китеп → Китеп\t123 → 123'));
});

test('paired export merges original and translation into one bilingual document, row for row',async()=>{
  const {buildDocument}=await import('../public/js/translation/model.mjs');
  const {buildDocumentXml,buildTranslationTxt,pairedLayoutBlocks}=await import('../public/js/translation/export.mjs');
  const original=buildDocument({fileName:'x',text:'Пункт один\n\nПункт два',fields:[{label:'ФИО',value:'Асан'}],columns:['Товар'],columnKeys:['name'],items:[{name:'Китеп'}]});
  const translation={...original,fields:[{...original.fields[0],value:'Asan'}],columns:['Item'],items:[{name:'Book'}],
    paragraphs:[{...original.paragraphs[0],text:'Point one\n\n'},{...original.paragraphs[1],text:'Point two'}]};
  const blocks=pairedLayoutBlocks(original,translation);
  // every original row appears exactly once — no dropped paragraphs, fields or items
  assert.equal(blocks.find(b=>b.table&&b.table[0][0]==='Поле').table.length,2); // header + 1 field
  const itemsBlock=blocks.find(b=>b.table&&b.table[0][0]&&b.table[0][0].__bi);
  assert.equal(itemsBlock.table[1][0].a,'Китеп');assert.equal(itemsBlock.table[1][0].b,'Book');
  const textBlock=blocks.find(b=>b.table&&b.table[0][0]==='Оригинал');
  assert.equal(textBlock.table.length,3); // header + 2 paragraphs, none merged or dropped
  assert.deepEqual(textBlock.table[1],['Пункт один\n\n','Point one\n\n']);
  const xml=buildDocumentXml(original,translation,true);
  for (const t of ['Асан','Asan','Китеп','Book','Пункт один','Point one']) assert.ok(xml.includes(t),`missing ${t}`);
  const txt=buildTranslationTxt(original,translation,true);
  assert.ok(txt.includes('Асан\tAsan'));assert.ok(txt.includes('Китеп → Book'));
});

function loadCommonJs(file,stubs,extras={}) {
  const vm=require('node:vm'),fs=require('node:fs');
  const context=vm.createContext({module:{exports:{}},process:{env:{GEMINI_API_KEY:'FAKE',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'FAKE'}},console,AbortSignal,...extras,require:name=>stubs[name]||require(name)});
  vm.runInContext(fs.readFileSync(file,'utf8'),context);return context.module.exports;
}

test('API gates protected clients and fails closed without spending OCR pages',async()=>{
  let charged=0,called=0;
  const {validateTranslationRequest}=require('../lib/translation');
  const stubs={
    '../lib/translation':{validateTranslationRequest,translateSegments:async()=>{called++;return {segments:[]};}},
    '../lib/translationQuota':{consumeTranslationQuota:async()=>{charged++;}},
    '../lib/customFieldsLookup':{getClientConfig:async()=>({passwordHash:'hash'})},
    '../lib/clientAuth':{requireClientSettingsAuth:()=>({ok:false,status:401,message:'Denied'})},
    '../lib/anonymousUsage':{extractClientIp:()=> 'test-ip'}
  };
  const invoke=async(stubs,body)=>{const api=loadCommonJs('api/translate.js',stubs);const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};await api({method:'POST',headers:{},body},res);return res;};
  stubs['../lib/translationAccess']=loadCommonJs('lib/translationAccess.js',{'./customFieldsLookup':stubs['../lib/customFieldsLookup'],'./clientAuth':stubs['../lib/clientAuth']});
  const body={language:'en',segments:[{id:'a',text:'Текст'}],clientSlug:'acme'};
  assert.equal((await invoke(stubs,body)).code,401);assert.equal(charged,0);assert.equal(called,0);
  stubs['../lib/clientAuth'].requireClientSettingsAuth=()=>({ok:true});
  stubs['../lib/translationAccess']=loadCommonJs('lib/translationAccess.js',{'./customFieldsLookup':stubs['../lib/customFieldsLookup'],'./clientAuth':stubs['../lib/clientAuth']});
  assert.equal((await invoke(stubs,body)).code,200);assert.equal(charged,1);assert.equal(called,1);
  stubs['../lib/translationQuota'].consumeTranslationQuota=async()=>{throw Object.assign(new Error('Unavailable'),{status:503});};
  assert.equal((await invoke(stubs,body)).code,503);assert.equal(called,1);
});

test('paid translation access rejects anonymous, unknown and passwordless clients', async()=>{
  const {requirePaidTranslationClient}=require('../lib/translationAccess');
  await assert.rejects(requirePaidTranslationClient({headers:{}},null),e=>e.status===403);
  await assert.rejects(requirePaidTranslationClient({headers:{}},'bad slug'),e=>e.status===400);
  const make=config=>loadCommonJs('lib/translationAccess.js',{'./customFieldsLookup':{getClientConfig:async()=>config},'./clientAuth':require('../lib/clientAuth')});
  await assert.rejects(make(null).requirePaidTranslationClient({headers:{}},'unknown'),e=>e.status===403);
  await assert.rejects(make({passwordHash:null}).requirePaidTranslationClient({headers:{}},'paid'),e=>e.status===403);
  const fs=require('node:fs');
  assert.equal(fs.existsSync('public/translation-templates'),false);
  assert.equal(fs.existsSync('public/js/translation/templates.mjs'),false);
});

test('quota uses isolated atomic daily and monthly counters and rejects malformed replies',async()=>{
  const requests=[];
  const quota=loadCommonJs('lib/translationQuota.js',{}, {fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>[{allowed:true}]};}});
  await quota.consumeTranslationQuota({identity:'client:test',authenticated:true});
  assert.equal(requests.length,2);assert.equal(requests[0].p_max_attempts,50);assert.equal(requests[1].p_max_attempts,1000);
  assert.ok(requests.every(r=>r.p_key.startsWith('translation:')&&!r.p_key.includes('client:test')));
  const broken=loadCommonJs('lib/translationQuota.js',{}, {fetch:async()=>({ok:true,json:async()=>[]})});
  await assert.rejects(broken.consumeTranslationQuota({identity:'ip:test',authenticated:false}),e=>e.status===503);
});

test('text requests separate instructions from content and reject truncated responses',async()=>{
  let sent;
  const make=finishReason=>loadCommonJs('lib/geminiClient.js',{'./geminiBudget':{reserveGeminiBudget:async()=>{}}},{fetch:async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({candidates:[{finishReason,content:{parts:[{text:'{"segments":[]}'}]}}]})};}});
  const args={apiKey:'FAKE',instruction:'Translate',sourceText:'untrusted source',schemaProperties:{},requiredFields:[]};
  await make('STOP').callGemini(args);assert.equal(sent.systemInstruction.parts[0].text,'Translate');assert.equal(sent.contents[0].parts[0].text,'untrusted source');assert.equal(sent.contents[0].parts.length,1);
  await assert.rejects(make('MAX_TOKENS').callGemini(args),e=>e.status===502);
});

test('model keeps preserved values and table coordinates through translation',async()=>{
  const {buildDocument,translationUnits,translatedDocument}=await import('../public/js/translation/model.mjs');
  const original=buildDocument({fileName:'x',text:'Пункт 1\n\nПункт 2',fields:[{label:'ФИО',value:'Асан'},{label:'Номер',value:'AB123'}],columns:['Товар','Цена'],columnKeys:['name','price'],items:[{name:'Китеп',price:'50'}]});
  const units=translationUnits(original);
  // ФИО и номер — не в очереди на перевод (ни имя, ни идентификатор не уходят в Gemini).
  assert.ok(!units.some(u=>u.text==='Асан'||u.text==='AB123'||u.text==='50'));
  const values=new Map(units.map(u=>[u.id,'Translation: '+u.text]));
  const result=translatedDocument(original,values,'en');
  // Номер — реальный идентификатор, не меняется никогда.
  assert.equal(result.fields[1].value,'AB123');assert.equal(result.items[0].price,'50');
  assert.equal(result.items[0].name,'Translation: Китеп');assert.equal(original.items[0].name,'Китеп');
  assert.equal(result.paragraphs.length,original.paragraphs.length);
});

test('names and place names are transliterated per notarial-translation rules, not translated and not left as-is for a Latin-script target',async()=>{
  const {buildDocument,translationUnits,translatedDocument,transliterate}=await import('../public/js/translation/model.mjs');
  const original=buildDocument({fileName:'x',text:'',fields:[{label:'ФИО',value:'Иванов Иван'},{label:'Место рождения',value:'г. Бишкек'},{label:'Номер',value:'AB123'}]});
  const units=translationUnits(original);
  // Имя и топоним не уходят в Gemini — транслитерация детерминированная, не машинный перевод.
  assert.ok(!units.some(u=>u.text==='Иванов Иван'||u.text==='г. Бишкек'));
  const toEnglish=translatedDocument(original,new Map(),'en');
  assert.equal(toEnglish.fields[0].value,'Ivanov Ivan');
  // "г." — административное сокращение, не часть топонима: убирается, а не
  // транслитерируется в "g." (решение Ethan, 13 сен 2026).
  assert.equal(toEnglish.fields[1].value,'Bishkek');
  assert.equal(transliterate('с. Кой-Таш','en'),'Koi-Tash');
  assert.equal(transliterate('Бишкек','en'),'Bishkek'); // без маркера — не задевается
  assert.notEqual(toEnglish.fields[0].value,original.fields[0].value); // не оставлено как в оригинале
  assert.equal(toEnglish.fields[2].value,'AB123'); // идентификатор не тронут
  // Кириллический целевой язык (кыргызский/казахский) — транслитерировать нечего, значение не меняется.
  const toKyrgyz=translatedDocument(original,new Map(),'ky');
  assert.equal(toKyrgyz.fields[0].value,'Иванов Иван');
});

test('translateSegments: an exact legal-phrase glossary match is substituted directly, Gemini is never called', async () => {
  let geminiCalled = 0;
  const { translateSegments } = loadCommonJs('lib/translation.js', {
    './geminiClient': { callGemini: async () => { geminiCalled++; return { result: { segments: [] }, usage: null }; }, GEMINI_MODEL: 'test' },
    './usageAnalytics': { recordUsageEvent: async () => ({ ok: true }) },
    './legalPhrases': { lookupLegalPhrases: async () => ({
      exact: { 'Нотариально удостоверено': { translatedValue: 'Нотариалдык жактан күбөлөндүрүлгөн', needsReview: true } },
      hints: []
    }) }
  });
  const result = await translateSegments({ language: 'ky', segments: [{ id: 'a', text: 'Нотариально удостоверено' }] }, 'client-a');
  assert.equal(geminiCalled, 0);
  assert.equal(result.usage, null);
  // JSON round-trip: objects built inside the vm-loaded module belong to a
  // different realm, so deepEqual would fail on prototype identity alone.
  assert.deepEqual(JSON.parse(JSON.stringify(result.segments)), [{ id: 'a', text: 'Нотариалдык жактан күбөлөндүрүлгөн', fromLegalPhrase: true, needsReview: true }]);
});

test('translateSegments: partial glossary hints reach the Gemini instruction, and only unmatched segments are sent', async () => {
  let sentInstruction, sentSource;
  const { translateSegments } = loadCommonJs('lib/translation.js', {
    './geminiClient': { callGemini: async (args) => {
      sentInstruction = args.instruction; sentSource = JSON.parse(args.sourceText);
      return { result: { segments: sentSource.map(s => ({ id: s.id, text: 'ky:' + s.text })) }, usage: { totalTokenCount: 5 } };
    }, GEMINI_MODEL: 'test' },
    './usageAnalytics': { recordUsageEvent: async () => ({ ok: true }) },
    './legalPhrases': { lookupLegalPhrases: async () => ({
      exact: { 'Нотариально удостоверено': { translatedValue: 'Нотариалдык жактан күбөлөндүрүлгөн', needsReview: false } },
      hints: [{ source: 'Вступает в силу с момента подписания', translated: 'Кол коюлган күндөн тартып күчүнө кирет', needsReview: true }]
    }) }
  });
  const result = await translateSegments({ language: 'ky', segments: [
    { id: 'a', text: 'Нотариально удостоверено' },
    { id: 'b', text: 'Договор вступает в силу с момента подписания сторонами.' }
  ] }, 'client-a');
  // Only the unmatched segment reaches Gemini — the exact match is never sent.
  assert.deepEqual(sentSource, [{ id: 'b', text: 'Договор вступает в силу с момента подписания сторонами.' }]);
  assert.ok(sentInstruction.includes('Вступает в силу с момента подписания'));
  assert.ok(sentInstruction.includes('Кол коюлган күндөн тартып күчүнө кирет'));
  assert.deepEqual(JSON.parse(JSON.stringify(result.segments)), [
    { id: 'a', text: 'Нотариалдык жактан күбөлөндүрүлгөн', fromLegalPhrase: true, needsReview: false },
    { id: 'b', text: 'ky:Договор вступает в силу с момента подписания сторонами.' }
  ]);
});

