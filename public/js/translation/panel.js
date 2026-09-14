import { LANGUAGES, buildDocument, applyTemplate, validateTemplate, translationUnits, translatedDocument, transliterate } from './model.mjs';
import { exportTxt, exportDocx, printTranslation, downloadBlob } from './export.mjs';
import { getClientSlug, getClientToken } from '../branding.js';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const button=text=>{const b=el('button',text,'btn-secondary');b.type='button';return b;};
const input=(label,value='')=>{const wrapper=el('label',label);const n=el('input');n.value=value;wrapper.append(n);return {wrapper,n};};

export async function initTranslation({getFileGroups}) {
  const slug=getClientSlug(),token=getClientToken();
  if(!slug||!token)return;
  let STARTER_TEMPLATES;
  try {
    const response=await fetch(`/api/translation-templates?slug=${encodeURIComponent(slug)}`,{headers:{'x-client-token':token},cache:'no-store'});
    if(!response.ok)return;
    const data=await response.json();
    if(!Array.isArray(data.templates))return;
    STARTER_TEMPLATES=data.templates.map(entry=>({id:entry.id,template:validateTemplate(entry.template)}));
  }catch(_){return;}
  const root=el('section',null,'translation-panel');root.hidden=true;
  document.getElementById('resultsPanel').append(root);

  // Шапка: заголовок + сворачиваемая справка вместо всегда видимого абзаца
  // (Ethan, 13 сен 2026: сделать этот экран более user-friendly).
  const header=el('div',null,'translation-header');
  const titleGroup=el('div',null,'translation-header-title');
  const icon=el('span',null,'translation-icon');
  icon.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h9M9 5v3M11 8c0 4-3 7-6 8M9.5 12c1.5 1.5 3.5 2.5 5.5 3"/><path d="M14 21l4-9 4 9M15.5 18h5"/></svg>';
  titleGroup.append(icon,el('h2','Перевод документа'));
  const howItWorks=el('details',null,'translation-info');
  howItWorks.append(el('summary','Как это работает'));
  howItWorks.append(el('p','Оригинал остаётся неизменным. Выбранные распознанные данные отправляются в Gemini для перевода, в том числе после локального OCR. Точный вид исходного скана не воспроизводится.','lang-note'));
  header.append(titleGroup,howItWorks);
  root.append(header);

  // Основной ряд: документ, язык, «Перевести» — то, что нужно почти всегда.
  const field=(labelText,control)=>{const wrap=el('div',null,'translation-field');wrap.append(el('span',labelText,'translation-field-label'),control);return wrap;};
  const setupRow=el('div',null,'translation-setup-row');
  const documents=el('select');documents.setAttribute('aria-label','Документ для перевода');
  const language=el('select');language.setAttribute('aria-label','Язык перевода');
  Object.entries(LANGUAGES).forEach(([value,label])=>{const o=el('option',label);o.value=value;language.append(o);});language.value='en';
  const start=button('Перевести');start.className='btn-primary';
  const cancel=button('Остановить');cancel.disabled=true;cancel.hidden=true;
  setupRow.append(field('Документ',documents),field('Язык перевода',language),start,cancel);
  root.append(setupRow);

  // Шаблон перевода — нужен не всем и не всегда, поэтому свёрнут по умолчанию.
  const templateSection=el('details',null,'translation-template');
  templateSection.append(el('summary','⚙ Шаблон перевода — необязательно'));
  const templateToolbar=el('div',null,'translation-template-toolbar');
  const library=el('select');library.setAttribute('aria-label','Начальные шаблоны перевода');
  const placeholder=el('option','Выбрать черновой образец…');placeholder.value='';library.append(placeholder);
  STARTER_TEMPLATES.forEach(entry=>{const option=el('option',entry.template.name);option.value=entry.id;library.append(option);});
  const configure=button('Настроить шаблон'),load=button('Загрузить шаблон'),clear=button('Без шаблона');
  const downloadTemplate=button('Скачать текущий шаблон');downloadTemplate.disabled=true;downloadTemplate.className='translation-link-btn';
  templateToolbar.append(library,configure,load,clear,downloadTemplate);
  templateSection.append(templateToolbar);
  root.append(templateSection);

  // Статус: раньше — один <p> с текстом на все случаи; теперь тот же текст,
  // но с визуальным кодированием (готово/предупреждение/ошибка = плашка
  // нужного цвета, обычный прогресс — просто текст) плюс отдельная полоса
  // прогресса во время самого перевода. См. draw()/start.onclick ниже —
  // это переработка представления, session.results/units не меняются.
  const message=el('div',null,'translation-status');message.setAttribute('role','status');root.append(message);
  const progressTrack=el('div',null,'translation-progress');progressTrack.hidden=true;
  const progressFill=el('div',null,'translation-progress-fill');progressTrack.append(progressFill);
  root.append(progressTrack);
  const STATUS_ICONS={
    success:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
    error:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0z"/></svg>',
    warning:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0z"/></svg>',
  };
  // kind: 'idle'|'progress' (обычный текст) | 'success'|'warning'|'error' (цветная плашка с иконкой)
  function setStatus(kind,text,meta) {
    message.className='translation-status'+(kind!=='idle'&&kind!=='progress'?` translation-status-${kind}`:'');
    message.replaceChildren();
    if(!text)return;
    if(STATUS_ICONS[kind]){
      const pill=el('span',null,'translation-status-pill');pill.innerHTML=STATUS_ICONS[kind];
      pill.append(document.createTextNode(' '+text));message.append(pill);
    } else message.append(el('span',text));
    if(meta)message.append(el('span',meta,'translation-status-meta'));
  }
  function setProgress(fraction) {
    if(fraction==null){progressTrack.hidden=true;return;}
    progressTrack.hidden=false;progressFill.style.width=`${Math.round(Math.max(0,Math.min(1,fraction))*100)}%`;
  }
  function badge(kind) {
    const map={preserved:['сохранено','translation-badge-accent'],translit:['транслитерация','translation-badge-translit'],
      unchanged:['без изменений','translation-badge-neutral'],pending:['ожидает','translation-badge-neutral'],done:['переведено','translation-badge-good']};
    const [text,cls]=map[kind];return el('span',text,`translation-badge ${cls}`);
  }
  const estimate=el('p',null,'translation-estimate');root.append(estimate);
  const templateNotice=el('p');root.append(templateNotice);
  const editor=el('div',null,'translation-template-editor');editor.hidden=true;root.append(editor);
  const content=el('div',null,'translation-content');root.append(content);
  const exports=el('div',null,'translation-toolbar');root.append(exports);
  const toolbarOption=el('div',null,'translation-toolbar-option');
  const pairedLabel=el('label','Оригинал рядом с переводом (двуязычный документ) '),paired=el('input');paired.type='checkbox';paired.checked=true;pairedLabel.prepend(paired);
  toolbarOption.append(pairedLabel);
  // Формат скачивания — раньше три равнозначные кнопки подряд, теперь один
  // выбор + одна кнопка (Ethan, 13 сен 2026: "чтобы человек мог выбрать,
  // через что скачивает"), как и остальные выборы на этой панели (Документ/
  // Язык перевода). "Печать / PDF" оставлен третьим пунктом списка — печать
  // технически не "скачивание файла", но раньше жила в этом же ряду кнопок.
  const toolbarButtons=el('div',null,'translation-toolbar-buttons');
  const formatSelect=el('select');formatSelect.setAttribute('aria-label','Формат скачивания');
  [['txt','TXT'],['docx','DOCX'],['pdf','Печать / PDF']].forEach(([value,text])=>{const o=el('option',text);o.value=value;formatSelect.append(o);});
  const downloadBtn=button('Скачать');downloadBtn.className='btn-primary';
  toolbarButtons.append(formatSelect,downloadBtn);
  exports.append(toolbarOption,toolbarButtons);exports.hidden=true;
  let template=null,session=null,controller=null,sequence=0;
  const cache=new Map(); // cleared with source replacement; never persisted
  let previousNodes=[];
  // Сетка результатов сворачиваема (Ethan, 13 сен 2026: "иначе будет слишком
  // длинное окно") — по умолчанию свёрнута, состояние помним между
  // перерисовками draw() (её вызывают много раз за один перевод), сбрасываем
  // при reset(), чтобы каждый новый документ/язык снова начинался свёрнутым.
  let gridExpanded=false;
  const rowsWord=n=>{const m10=n%10,m100=n%100;if(m10===1&&m100!==11)return 'строка';if(m10>=2&&m10<=4&&(m100<12||m100>14))return 'строки';return 'строк';};

  function snapshot() {return getFileGroups()[Number(documents.value)];}
  function fingerprint() {return JSON.stringify({source:snapshot(),language:language.value,template,client:getClientSlug()});}
  function stale() {return !session || session.fingerprint!==fingerprint();}
  function reset() {sequence++;controller?.abort();controller=null;session=null;content.replaceChildren();exports.hidden=true;start.disabled=false;cancel.disabled=true;cancel.hidden=true;setStatus('idle','');setProgress(null);gridExpanded=false;updateEstimate();}
  function updateEstimate() {
    if(!snapshot()){estimate.textContent='';return;}
    const source=applyTemplate(buildDocument(snapshot()),template,language.value).document;
    const pending=translationUnits(source).filter(u=>!cache.has(key(u)));
    const count=pending.reduce((sum,u)=>sum+u.text.length,0);
    estimate.textContent=`Новых символов к переводу: ${count}. Сохраняемые реквизиты и готовые фрагменты не отправляются повторно. До 2000 символов в запросе; для платного клиента по умолчанию 50 запросов за 24 часа.`;
  }
  function sourceChanged() {
    updateEstimate();
    if(session && stale()){controller?.abort();exports.hidden=true;setStatus('warning','Исходные данные изменились. Запустите перевод снова; неизменившиеся фрагменты будут использованы повторно.');}
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
  importer.onchange=async()=>{try{const f=importer.files[0];if(!f)return;if(f.size>65536)throw new Error('Шаблон должен быть меньше 64 КБ.');template=validateTemplate(JSON.parse(await f.text()));library.value='';downloadTemplate.disabled=false;reset();templateNotice.textContent=`Загружен шаблон «${template.name}». Проверьте соответствие форме и переводы подписей.`;}catch(e){setStatus('error',e.message);}finally{importer.value='';}};

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
    }catch(e){setStatus('error',e.message);}};
    editor.append(add,save);
  };

  // Сетка результатов (13 сен 2026): та же логика данных, что и раньше
  // (session.units/results/key()/export не тронуты) — но каждое поле теперь
  // отдельная строка со статус-плашкой, а не спрятано в <details>. Поля с
  // preserve/kind==='name' не имеют unit'ов (см. translationUnits в model.mjs),
  // поэтому для них строки строятся напрямую из session.document.fields.
  function draw() {
    content.replaceChildren();if(!session)return;
    const banner=el('div',null,'translation-warning-banner');
    const bannerIcon=el('span');bannerIcon.innerHTML=STATUS_ICONS.warning;bannerIcon.setAttribute('aria-hidden','true');
    banner.append(bannerIcon,el('span','Машинный перевод, не проверен переводчиком. ФИО и топонимы — автоматическая транслитерация, а не перевод: сверьте написание с загранпаспортом. Печати, подписи и неразборчивые фрагменты проверьте по оригиналу.'));
    content.append(banner);

    const grid=el('div',null,'translation-grid');
    const head=el('div',null,'translation-grid-row translation-grid-head');
    head.append(el('span','Оригинал'),el('span','Перевод'),el('span','Статус'));
    grid.append(head);
    let rowIndex=0;
    function appendRow(sourceContent,targetContent,badgeKind) {
      const row=el('div',null,'translation-grid-row'+(rowIndex++%2?' translation-grid-row-alt':''));
      const source=el('div',null,'translation-grid-cell');source.dataset.label='Оригинал';source.append(sourceContent);
      const target=el('div',null,'translation-grid-cell');target.dataset.label='Перевод';target.append(targetContent);
      const status=el('div',null,'translation-grid-cell');status.dataset.label='Статус';status.append(badge(badgeKind));
      row.append(source,target,status);grid.append(row);
    }
    function sourceBlock(labelText,valueText) {
      const wrap=el('div');if(labelText)wrap.append(el('div',labelText,'translation-grid-source-label'));wrap.append(document.createTextNode(valueText));return wrap;
    }
    function unitTarget(unit) {
      const area=el('textarea');area.setAttribute('aria-label',`Перевод: ${unit.text}`);area.rows=Math.min(12,Math.max(2,Math.ceil(unit.text.length/70)));
      area.value=session.results.get(unit.id)||'';area.disabled=!session.results.has(unit.id);area.placeholder='Ожидает перевода';
      area.oninput=()=>{session.results.set(unit.id,area.value);updateExports();};
      return area;
    }
    const staticInput=value=>{const n=el('input');n.value=value;n.disabled=true;return n;};

    const unitsByPrefix=new Map();
    session.units.forEach(u=>{const m=u.id.match(/^(f\d+[lv])_\d+$/);if(m){const arr=unitsByPrefix.get(m[1])||[];arr.push(u);unitsByPrefix.set(m[1],arr);}});

    session.document.fields.forEach(f=>{
      (unitsByPrefix.get(`${f.id}l`)||[]).forEach(u=>appendRow(sourceBlock(`${f.label} — подпись поля`,u.text),unitTarget(u),session.results.has(u.id)?'done':'pending'));
      if(f.preserve) {
        appendRow(sourceBlock(f.label,f.value),staticInput(f.value),'preserved');
      } else if(f.kind==='name') {
        const override=el('input');override.setAttribute('aria-label',`Транслитерация: ${f.label}`);
        override.value=session.nameOverrides.get(f.id) ?? session.verifiedNames.get(f.value) ?? transliterate(f.value,language.value);
        override.oninput=()=>session.nameOverrides.set(f.id,override.value);
        appendRow(sourceBlock(f.label,f.value),override,'translit');
      } else {
        const valueUnits=unitsByPrefix.get(`${f.id}v`)||[];
        if(valueUnits.length){valueUnits.forEach(u=>appendRow(sourceBlock(f.label,u.text),unitTarget(u),session.results.has(u.id)?'done':'pending'));}
        else{appendRow(sourceBlock(f.label,f.value),staticInput(f.value),'unchanged');}
      }
    });
    session.units.forEach(u=>{if(!/^f\d+[lv]_\d+$/.test(u.id))appendRow(sourceBlock(null,u.text),unitTarget(u),session.results.has(u.id)?'done':'pending');});

    const gridWrap=el('details',null,'translation-grid-details');
    gridWrap.open=gridExpanded;
    const gridSummary=el('summary',null,'translation-grid-summary');
    const summaryText=()=>`${gridWrap.open?'Скрыть':'Показать'} таблицу результатов — ${rowIndex} ${rowsWord(rowIndex)}`;
    gridSummary.textContent=summaryText();
    gridWrap.addEventListener('toggle',()=>{gridExpanded=gridWrap.open;gridSummary.textContent=summaryText();});
    gridWrap.append(gridSummary,grid);
    content.append(gridWrap);
    updateExports();
  }
  function updateExports(){exports.hidden=stale()||session.units.some(u=>!session.results.get(u.id)?.trim())||!!controller;}
  function key(unit){return JSON.stringify(['v1',getClientSlug(),snapshot()?.docType,language.value,unit.id.replace(/\d/g,''),unit.text]);}
  // Словарь проверенных транслитераций (общий между клиентами, см.
  // lib/verifiedTransliterations.js) — подсказка ЛУЧШЕ обычной transliterate()
  // для ФИО/топонимов, которые уже кто-то поправил вручную раньше. Грузится
  // асинхронно и не блокирует рисование грида (draw() и так безопасно падает
  // обратно на transliterate(), пока запрос не вернулся). forSession!==session
  // — защита от гонки: пока грузилось, могли начать перевод другого
  // документа/языка, тогда ответ просто игнорируется.
  function fetchVerifiedNames(forSession) {
    const originals=[...new Set(forSession.document.fields.filter(f=>f.kind==='name' && f.value?.trim()).map(f=>f.value))].slice(0,50);
    if(!originals.length)return;
    const token=getClientToken();
    fetch('/api/transliterations',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'x-client-token':token}:{})},
      body:JSON.stringify({action:'lookup',clientSlug:getClientSlug(),originals})})
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        if(!data?.values || forSession!==session)return;
        for(const [original,value] of Object.entries(data.values))forSession.verifiedNames.set(original,value);
        draw();
      }).catch(()=>{});
  }
  // Подтверждение — клиент вручную поправил (или сознательно оставил) поле
  // транслитерации, значит это разумно надёжный вариант. Fire-and-forget
  // (см. api/transliterations.js:confirm) — сбой записи не должен мешать
  // уже готовому скачиванию, поэтому вызывается без await из ready().
  function confirmNameOverrides() {
    const entries=[];
    session.document.fields.forEach(f=>{
      if(f.kind==='name' && session.nameOverrides.has(f.id)) {
        const verifiedValue=session.nameOverrides.get(f.id);
        if(verifiedValue?.trim())entries.push({original:f.value,verifiedValue});
      }
    });
    if(!entries.length)return;
    const token=getClientToken();
    fetch('/api/transliterations',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'x-client-token':token}:{})},
      body:JSON.stringify({action:'confirm',clientSlug:getClientSlug(),entries})}).catch(()=>{});
  }
  start.onclick=async()=>{
    if(controller || !snapshot())return;
    const run=++sequence;
    const original=buildDocument(snapshot());
    const applied=applyTemplate(original,template,language.value);templateNotice.textContent=applied.message;
    const units=translationUnits(applied.document);
    if(!units.length && !original.fields.length){setStatus('warning','Нет текста для перевода. Включите извлечение полного текста при распознавании.');return;}
    const old=!stale()?session:null;
    session={fingerprint:fingerprint(),original,document:applied.document,units,results:old?.results||new Map(),nameOverrides:old?.nameOverrides||new Map(),verifiedNames:old?.verifiedNames||new Map()};
    fetchVerifiedNames(session);
    for(const u of units)if(!session.results.has(u.id) && cache.has(key(u)))session.results.set(u.id,cache.get(key(u)));
    const pending=units.filter(u=>!session.results.has(u.id));
    const batches=[];let batch=[],size=0;
    for(const u of pending){if(batch.length && (size+u.text.length>2000 || batch.length>=50)){batches.push(batch);batch=[];size=0;}batch.push(u);size+=u.text.length;}if(batch.length)batches.push(batch);
    const total=pending.reduce((n,u)=>n+u.text.length,0);
    controller=new AbortController();const signal=controller.signal;start.disabled=true;cancel.disabled=false;cancel.hidden=false;draw();
    setStatus('progress',`К переводу: ${total} символов, запросов: ${batches.length}. Страницы OCR не списываются.`);setProgress(0);
    try{
      for(let i=0;i<batches.length;i++){
        if(signal.aborted || stale())throw new DOMException('Остановлено','AbortError');
        setStatus('progress',`Перевод: запрос ${i+1} из ${batches.length} (${total} символов).`);setProgress(i/batches.length);
        const token=getClientToken();
        const response=await fetch('/api/translate',{method:'POST',signal,headers:{'Content-Type':'application/json',...(token?{'x-client-token':token}:{})},body:JSON.stringify({language:language.value,segments:batches[i],clientSlug:getClientSlug()})});
        let data;try{data=await response.json();}catch(_){throw new Error('Сервер не вернул перевод. Попробуйте позже.');}
        if(!response.ok)throw new Error(data.error||`Ошибка перевода (${response.status}).`);
        if(run!==sequence || stale())throw new DOMException('Остановлено','AbortError');
        if(!Array.isArray(data.segments)||data.segments.length!==batches[i].length)throw new Error('Неполный ответ перевода.');
        for(const u of batches[i]){const translated=data.segments.find(s=>s.id===u.id);if(typeof translated?.text!=='string'||!translated.text.trim())throw new Error('В ответе отсутствует фрагмент.');session.results.set(u.id,translated.text);cache.set(key(u),translated.text);}
        draw();
      }
      setProgress(null);setStatus('success','Перевод готов к проверке. Его можно исправить и скачать.');
    }catch(e){if(run===sequence){setProgress(null);setStatus(e.name==='AbortError'?'warning':'error',e.name==='AbortError'?'Остановлено. Готовые фрагменты сохранены в этой вкладке. Нажмите «Перевести» для продолжения.':e.message+' Готовые фрагменты сохранены; повтор продолжит оставшиеся.');}}
    finally{if(run===sequence){controller=null;start.disabled=false;cancel.disabled=true;cancel.hidden=true;updateExports();}}
  };
  function ready(action){
    if(stale()||exports.hidden){setStatus('warning','Сначала завершите перевод актуальной версии.');return;}
    try{
      const translated=translatedDocument(session.document,session.results,language.value);
      if(session.nameOverrides.size){
        translated.fields=translated.fields.map((f,i)=>{
          const src=session.document.fields[i];
          return (src && session.nameOverrides.has(src.id))?{...f,value:session.nameOverrides.get(src.id)}:f;
        });
        confirmNameOverrides();
      }
      Promise.resolve(action(session.original,translated,paired.checked)).catch(e=>setStatus('error',e.message));
    }catch(e){setStatus('error',e.message);}
  }
  const FORMAT_ACTIONS={txt:exportTxt,docx:exportDocx,pdf:printTranslation};
  downloadBtn.onclick=()=>ready(FORMAT_ACTIONS[formatSelect.value]);
  refreshDocuments();
}
