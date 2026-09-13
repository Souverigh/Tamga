import { LANGUAGES, buildDocument, applyTemplate, validateTemplate, translationUnits, translatedDocument } from './model.mjs';
import { exportTxt, exportDocx, printTranslation, downloadBlob } from './export.mjs';
import { getClientSlug, getClientToken } from '../branding.js';
import { STARTER_TEMPLATES } from './templates.mjs';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const button=text=>{const b=el('button',text,'btn-secondary');b.type='button';return b;};
const input=(label,value='')=>{const wrapper=el('label',label);const n=el('input');n.value=value;wrapper.append(n);return {wrapper,n};};

export function initTranslation({getFileGroups}) {
  const root=el('section',null,'translation-panel');root.hidden=true;
  document.getElementById('resultsPanel').append(root);
  root.append(el('h2','Перевод документа'));
  root.append(el('p','Оригинал остаётся неизменным. Выбранные распознанные данные отправляются в Gemini для перевода, в том числе после локального OCR. Точный вид исходного скана не воспроизводится.'));
  const toolbar=el('div',null,'translation-toolbar');root.append(toolbar);
  const documents=el('select');documents.setAttribute('aria-label','Документ для перевода');
  const language=el('select');language.setAttribute('aria-label','Язык перевода');
  Object.entries(LANGUAGES).forEach(([value,label])=>{const o=el('option',label);o.value=value;language.append(o);});language.value='en';
  const start=button('Перевести'),cancel=button('Остановить'),configure=button('Настроить шаблон'),load=button('Загрузить шаблон'),clear=button('Без шаблона');cancel.disabled=true;
  toolbar.append(documents,language,start,cancel,configure,load,clear);
  const library=el('select');library.setAttribute('aria-label','Начальные шаблоны перевода');
  const placeholder=el('option','Выбрать черновой образец…');placeholder.value='';library.append(placeholder);
  STARTER_TEMPLATES.forEach(entry=>{const option=el('option',entry.template.name);option.value=entry.id;library.append(option);});
  const downloadTemplate=button('Скачать текущий шаблон');downloadTemplate.disabled=true;
  toolbar.append(library,downloadTemplate);
  const message=el('p');message.setAttribute('role','status');root.append(message);
  const estimate=el('p');root.append(estimate);
  const templateNotice=el('p');root.append(templateNotice);
  const editor=el('div',null,'translation-template-editor');editor.hidden=true;root.append(editor);
  const content=el('div',null,'translation-content');root.append(content);
  const exports=el('div',null,'translation-toolbar');root.append(exports);
  const pairedLabel=el('label','Включить оригинал (распознанные данные) '),paired=el('input');paired.type='checkbox';paired.checked=true;pairedLabel.prepend(paired);
  const txt=button('Скачать TXT'),docx=button('Скачать DOCX'),pdf=button('Печать / PDF');exports.append(pairedLabel,txt,docx,pdf);exports.hidden=true;
  let template=null,session=null,controller=null,sequence=0;
  const cache=new Map(); // cleared with source replacement; never persisted
  let previousNodes=[];

  function snapshot() {return getFileGroups()[Number(documents.value)];}
  function fingerprint() {return JSON.stringify({source:snapshot(),language:language.value,template,client:getClientSlug()});}
  function stale() {return !session || session.fingerprint!==fingerprint();}
  function reset() {sequence++;controller?.abort();controller=null;session=null;content.replaceChildren();exports.hidden=true;start.disabled=false;cancel.disabled=true;message.textContent='';updateEstimate();}
  function updateEstimate() {
    if(!snapshot()){estimate.textContent='';return;}
    const source=applyTemplate(buildDocument(snapshot()),template,language.value).document;
    const pending=translationUnits(source).filter(u=>!cache.has(key(u)));
    const count=pending.reduce((sum,u)=>sum+u.text.length,0);
    estimate.textContent=`Новых символов к переводу: ${count}. Сохраняемые реквизиты и готовые фрагменты не отправляются повторно. До 2000 символов в запросе; не более 5 запросов за 24 часа без входа, 50 после входа по умолчанию.`;
  }
  function sourceChanged() {
    updateEstimate();
    if(session && stale()){controller?.abort();exports.hidden=true;message.textContent='Исходные данные изменились. Запустите перевод снова; неизменившиеся фрагменты будут использованы повторно.';}
  }
  function refreshDocuments() {
    const nodes=Array.from(document.querySelectorAll('#pageResults > .file-result-group'));
    if(nodes.length===previousNodes.length && nodes.every((n,i)=>n===previousNodes[i]))return;
    previousNodes=nodes;reset();cache.clear();documents.replaceChildren();
    getFileGroups().forEach((g,i)=>{const o=el('option',`${i+1}. ${g.fileName}`);o.value=String(i);documents.append(o);});root.hidden=!nodes.length;updateEstimate();
  }
  new MutationObserver(refreshDocuments).observe(document.getElementById('pageResults'),{childList:true});
  document.getElementById('pageResults').addEventListener('input',sourceChanged);
  document.getElementById('pageResults').addEventListener('change',sourceChanged);
  new MutationObserver(sourceChanged).observe(document.getElementById('pageResults'),{childList:true,subtree:true});
  documents.onchange=()=>{reset();editor.hidden=true;};language.onchange=()=>{reset();editor.hidden=true;};
  cancel.onclick=()=>controller?.abort();
  clear.onclick=()=>{template=null;library.value='';downloadTemplate.disabled=true;reset();templateNotice.textContent='Шаблон отключён.';editor.hidden=true;};
  library.onchange=()=>{
    const entry=STARTER_TEMPLATES.find(item=>item.id===library.value);if(!entry)return;
    template=validateTemplate(entry.template);language.value=template.language;reset();editor.hidden=true;downloadTemplate.disabled=false;
    templateNotice.textContent=`${template.name}. Проверьте подписи по оригиналу. Это общий образец, не проверенная государственная форма. Изменения через «Настроить шаблон» создают вашу копию.`;
  };
  downloadTemplate.onclick=()=>{if(template)downloadBlob(new Blob([JSON.stringify(template,null,2)],{type:'application/json'}),'translation-template.json');};
  const importer=el('input');importer.type='file';importer.accept='.json,application/json';importer.hidden=true;root.append(importer);
  load.onclick=()=>importer.click();
  importer.onchange=async()=>{try{const f=importer.files[0];if(!f)return;if(f.size>65536)throw new Error('Шаблон должен быть меньше 64 КБ.');template=validateTemplate(JSON.parse(await f.text()));library.value='';downloadTemplate.disabled=false;reset();templateNotice.textContent=`Загружен шаблон «${template.name}». Проверьте соответствие форме и переводы подписей.`;}catch(e){message.textContent=e.message;}finally{importer.value='';}};

  configure.onclick=()=>{
    if(!snapshot())return;
    editor.replaceChildren();editor.hidden=false;
    editor.append(el('h3','Шаблон перевода формы'));
    editor.append(el('p','Укажите проверенные переводы подписей. Порядок строк задаёт порядок полей. Шаблон сохраняет только названия и правила, без значений документов. Полный текст и дополнительные поля не удаляются.'));
    const name=input('Название ',template?.name||'Мой шаблон'),type=input('Тип документа ',snapshot().docType);editor.append(name.wrapper,type.wrapper);
    const marker=input('Признак формы / версии (фраза из оригинала, необязательно) ',template?.matchText?.[0]||'');editor.append(marker.wrapper);
    const rows=el('div');editor.append(rows);
    function addRow(rule={}) {
      const row=el('div',null,'translation-template-row');
      const source=input('Поле оригинала ',rule.source||''),target=input('Перевод подписи ',rule.target||'');
      const required=el('input');required.type='checkbox';required.checked=rule.required!==false;
      const preserve=el('input');preserve.type='checkbox';preserve.checked=!!rule.preserve;
      const rl=el('label','Обязательное ');rl.prepend(required);const pl=el('label','Не переводить значение ');pl.prepend(preserve);
      const remove=button('Удалить');remove.onclick=()=>row.remove();row.append(source.wrapper,target.wrapper,rl,pl,remove);
      row.read=()=>({source:source.n.value,target:target.n.value,required:required.checked,preserve:preserve.checked});rows.append(row);
    }
    (template?.fields||buildDocument(snapshot()).fields.map(f=>({source:f.label,target:'',required:true,preserve:f.preserve}))).forEach(addRow);
    const add=button('Добавить поле'),save=button('Применить и скачать шаблон');add.onclick=()=>addRow();
    save.onclick=()=>{try{
      template=validateTemplate({version:1,name:name.n.value,docType:type.n.value,language:language.value,matchText:marker.n.value.trim()?[marker.n.value]:[],fields:Array.from(rows.children).map(r=>r.read())});
      library.value='';downloadTemplate.disabled=false;
      reset();templateNotice.textContent=`Шаблон «${template.name}» готов. Перед использованием проверьте соответствие оригиналу.`;
      downloadBlob(new Blob([JSON.stringify(template,null,2)],{type:'application/json'}),'translation-template.json');editor.hidden=true;
    }catch(e){message.textContent=e.message;}};
    editor.append(add,save);
  };

  function draw() {
    content.replaceChildren();if(!session)return;
    content.append(el('p','Машинный перевод, не проверен переводчиком. Проверьте ФИО, печати, подписи и неразборчивые фрагменты по исходному файлу.'));
    const table=el('table');const head=el('tr');head.append(el('th','Оригинал — распознанные данные'),el('th','Перевод / сохранённое значение'));table.append(head);
    const units=session.units;
    for(const unit of units){
      const row=el('tr'),source=el('td',unit.text),target=el('td');const area=el('textarea');area.setAttribute('aria-label',`Перевод ${unit.id}`);area.rows=Math.min(12,Math.max(2,Math.ceil(unit.text.length/70)));
      area.value=session.results.get(unit.id)||'';area.disabled=!session.results.has(unit.id);area.placeholder='Ожидает перевода';
      area.oninput=()=>{session.results.set(unit.id,area.value);updateExports();};target.append(area);row.append(source,target);table.append(row);
    }
    content.append(table);
    const protectedFields=session.document.fields.filter(f=>f.preserve||f.targetLabel);
    if(protectedFields.length){const note=el('details');note.append(el('summary','Подписи шаблона и сохраняемые реквизиты'));protectedFields.forEach(f=>note.append(el('p',`${f.label} → ${f.targetLabel||f.label}: ${f.value}`)));content.append(note);}
    updateExports();
  }
  function updateExports(){exports.hidden=stale()||session.units.some(u=>!session.results.get(u.id)?.trim())||!!controller;}
  function key(unit){return JSON.stringify(['v1',getClientSlug(),snapshot()?.docType,language.value,unit.id.replace(/\d/g,''),unit.text]);}
  start.onclick=async()=>{
    if(controller || !snapshot())return;
    const run=++sequence;
    const original=buildDocument(snapshot());
    const applied=applyTemplate(original,template,language.value);templateNotice.textContent=applied.message;
    const units=translationUnits(applied.document);
    if(!units.length && !original.fields.length){message.textContent='Нет текста для перевода. Включите извлечение полного текста при распознавании.';return;}
    const old=!stale()?session:null;
    session={fingerprint:fingerprint(),original,document:applied.document,units,results:old?.results||new Map()};
    for(const u of units)if(!session.results.has(u.id) && cache.has(key(u)))session.results.set(u.id,cache.get(key(u)));
    const pending=units.filter(u=>!session.results.has(u.id));
    const batches=[];let batch=[],size=0;
    for(const u of pending){if(batch.length && (size+u.text.length>2000 || batch.length>=50)){batches.push(batch);batch=[];size=0;}batch.push(u);size+=u.text.length;}if(batch.length)batches.push(batch);
    const total=pending.reduce((n,u)=>n+u.text.length,0);
    controller=new AbortController();const signal=controller.signal;start.disabled=true;cancel.disabled=false;draw();
    message.textContent=`К переводу: ${total} символов, запросов: ${batches.length}. Страницы OCR не списываются.`;
    try{
      for(let i=0;i<batches.length;i++){
        if(signal.aborted || stale())throw new DOMException('Остановлено','AbortError');
        message.textContent=`Перевод: запрос ${i+1} из ${batches.length} (${total} символов).`;
        const token=getClientToken();
        const response=await fetch('/api/translate',{method:'POST',signal,headers:{'Content-Type':'application/json',...(token?{'x-client-token':token}:{})},body:JSON.stringify({language:language.value,segments:batches[i],clientSlug:getClientSlug()})});
        let data;try{data=await response.json();}catch(_){throw new Error('Сервер не вернул перевод. Попробуйте позже.');}
        if(!response.ok)throw new Error(data.error||`Ошибка перевода (${response.status}).`);
        if(run!==sequence || stale())throw new DOMException('Остановлено','AbortError');
        if(!Array.isArray(data.segments)||data.segments.length!==batches[i].length)throw new Error('Неполный ответ перевода.');
        for(const u of batches[i]){const translated=data.segments.find(s=>s.id===u.id);if(typeof translated?.text!=='string'||!translated.text.trim())throw new Error('В ответе отсутствует фрагмент.');session.results.set(u.id,translated.text);cache.set(key(u),translated.text);}
        draw();
      }
      message.textContent='Перевод готов к проверке. Его можно исправить и скачать.';
    }catch(e){if(run===sequence)message.textContent=e.name==='AbortError'?'Остановлено. Готовые фрагменты сохранены в этой вкладке. Нажмите «Перевести» для продолжения.':e.message+' Готовые фрагменты сохранены; повтор продолжит оставшиеся.';}
    finally{if(run===sequence){controller=null;start.disabled=false;cancel.disabled=true;updateExports();}}
  };
  function ready(action){if(stale()||exports.hidden){message.textContent='Сначала завершите перевод актуальной версии.';return;}try{Promise.resolve(action(session.original,translatedDocument(session.document,session.results),paired.checked)).catch(e=>message.textContent=e.message);}catch(e){message.textContent=e.message;}}
  txt.onclick=()=>ready(exportTxt);docx.onclick=()=>ready(exportDocx);pdf.onclick=()=>ready(printTranslation);
  refreshDocuments();
}
