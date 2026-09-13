export const LANGUAGES = {ru:'Русский',ky:'Кыргызский',en:'Английский',kk:'Казахский',uz:'Узбекский',tr:'Турецкий',zh:'Китайский',de:'Немецкий'};

export function splitText(text, max = 2000) {
  if (!Number.isInteger(max) || max < 2) throw new Error('Invalid chunk size');
  const chunks = [];
  while (text.length > max) {
    let end = text.lastIndexOf('\n',max-1)+1;
    if (end < max/2) end = text.lastIndexOf(' ',max-1)+1;
    if (end < max/2) end = max;
    if (/[\uD800-\uDBFF]/.test(text[end-1])) end--;
    chunks.push(text.slice(0,end)); text = text.slice(end);
  }
  if (text) chunks.push(text);
  return chunks;
}

const str = value => value == null ? '' : String(value);

// Правило перевода (не наша выдумка, а нотариальная практика — см. обсуждение
// с Ethan, 13 сен 2026): ФИО и топонимы в официальном переводе НЕ переводятся
// по смыслу и НЕ остаются как есть, если целевой язык на другом алфавите —
// они транслитерируются побуквенно по стандарту (для нас — таблица, близкая
// к ГОСТ 7.79-2000/приказу МИД РФ, той же логике, что заложена в ICAO 9303 для
// машиночитаемой зоны загранпаспорта). Только реальные идентификаторы (номера,
// счета, IBAN/VIN, даты в цифрах) не меняются вообще — их менять действительно
// нечего. Метки полей ("ФИО", "Номер") — обычный текст, переводятся как обычно.
const NAME_OR_PLACE_LABEL = /ФИО|Фамилия|Имя|Отчество|Место/i;
const PRESERVE_LABEL = /ПИН|ИНН|номер|счёт|IBAN|VIN|дата/i;

// Кириллица → латиница, побуквенно, регистронезависимая таблица (применяется
// с сохранением регистра исходной буквы). Русский/киргизский алфавит плюс три
// специфичных киргизских буквы (ң/ү/ө) — упрощённая передача без диакритики,
// т.к. официальные машиночитаемые форматы её не используют. Для казахских букв,
// отсутствующих здесь, буква проходит без изменений (см. предупреждение при
// экспорте — как и с киргизским UI, машинный результат нужен на проверку
// носителем языка перед использованием в качестве официального документа).
const TRANSLIT_TABLE = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',
  л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'tc',
  ч:'ch',ш:'sh',щ:'shch',ъ:'ie',ы:'y',ь:'',э:'e',ю:'iu',я:'ia',
  ң:'ng',ү:'u',ө:'o',
};
// Целевые языки латинского письма — только для них транслитерация вообще
// нужна. Кыргызский/казахский остаются кириллицей — менять нечего. Китайский
// формального стандарта передачи иностранных имён внутри перевода не имеет
// (фонетическая запись иероглифами — отдельная, не решённая здесь задача);
// пока используем ту же латинскую транслитерацию как более безопасный минимум,
// чем оставить кириллицу нечитаемой для получателя — см. TECH_DEBT.md.
const LATIN_SCRIPT_LANGUAGES = new Set(['en','de','uz','tr','zh']);

export function transliterate(value, language) {
  if (!LATIN_SCRIPT_LANGUAGES.has(language)) return value;
  return Array.from(str(value)).map(ch => {
    const lower = ch.toLowerCase();
    const mapped = TRANSLIT_TABLE[lower];
    if (mapped === undefined) return ch;
    if (ch !== lower) return mapped.charAt(0).toUpperCase() + mapped.slice(1);
    return mapped;
  }).join('');
}

export function buildDocument(source) {
  const paragraphs = (str(source.text).match(/[^\n]+(?:\n+|$)|\n+/g) || []).map((text,i)=>({id:`p${i}`,text}));
  return {
    name:str(source.fileName),docType:str(source.docType),paragraphs,
    fields:(source.fields||[]).map((f,i)=>{
      const label=str(f.label);
      return {id:`f${i}`,label,value:str(f.value),
        preserve:PRESERVE_LABEL.test(label),
        kind:NAME_OR_PLACE_LABEL.test(label)?'name':null};
    }),
    columns:(source.columns||[]).map(str),keys:(source.columnKeys||[]).map(str),
    items:(source.items||[]).map(row=>Object.fromEntries((source.columnKeys||[]).map(k=>[k,str(row[k])])) )
  };
}

export function validateTemplate(input) {
  if (!input || input.version!==1 || !Object.hasOwn(LANGUAGES,input.language) || !Array.isArray(input.fields) || input.fields.length>100) throw new Error('Некорректный шаблон версии 1.');
  const label = value => {
    if (typeof value !== 'string' || !value.trim() || value.length>200) throw new Error('Заполните названия шаблона и полей (до 200 символов).');
    return value.trim();
  };
  const seen = new Set();
  const matchText = input.matchText === undefined ? [] : input.matchText;
  if (!Array.isArray(matchText) || matchText.length > 10) throw new Error('Допускается до 10 признаков формы.');
  return {version:1,name:label(input.name),docType:label(input.docType),language:input.language,matchText:matchText.map(label),fields:input.fields.map(f=>{
    const source = label(f.source);
    if (seen.has(source)) throw new Error('Повторяющееся поле шаблона: '+source);
    seen.add(source);
    return {source,target:label(f.target),required:f.required===true,preserve:f.preserve===true};
  })};
}

export function applyTemplate(document, template, language) {
  if (!template) return {document,applied:false,message:'Перевод исходной структуры.'};
  const t = validateTemplate(template);
  if (t.docType !== document.docType || t.language !== language) return {document,applied:false,message:'Тип документа или язык не соответствует шаблону. Используется исходная структура.'};
  const fullText = document.paragraphs.map(p=>p.text).join('').normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
  if (t.matchText.some(text=>!fullText.includes(text.normalize('NFKC').replace(/\s+/g,' ').toLowerCase()))) return {document,applied:false,message:'Признаки версии формы не найдены. Используется исходная структура.'};
  const available = new Map();
  for (const f of document.fields) available.set(f.label,(available.get(f.label)||0)+1);
  if (document.fields.some(f=>available.get(f.label)>1) || t.fields.some(f=>f.required && (!available.has(f.source) || !document.fields.find(x=>x.label===f.source)?.value.trim()))) return {document,applied:false,message:'Не хватает обязательных значений или поля неоднозначны. Используется исходная структура.'};
  const fields = [];
  for (const rule of t.fields) {
    const field = document.fields.find(f=>f.label===rule.source);
    if (field) fields.push({...field,targetLabel:rule.target,preserve:field.preserve||rule.preserve});
  }
  const unmatched = document.fields.filter(f=>!t.fields.some(r=>r.source===f.label));
  fields.push(...unmatched);
  return {document:{...document,fields},applied:true,message:`Шаблон «${t.name}». Полей вне шаблона: ${unmatched.length}. Полный текст и таблицы также включены.`};
}

export function translationUnits(doc) {
  const units = [];
  function add(id,text) {
    splitText(text).forEach((part,i)=>{if(part.trim()) units.push({id:`${id}_${i}`,text:part});});
  }
  doc.paragraphs.forEach(p=>add(p.id,p.text));
  doc.fields.forEach(f=>{if(!f.targetLabel)add(`${f.id}l`,f.label);if(!f.preserve && f.kind!=='name' && !/^[\d\s.,:/+()%-]*$/.test(f.value))add(`${f.id}v`,f.value);});
  doc.columns.forEach((c,i)=>add(`c${i}`,c));
  doc.items.forEach((row,r)=>doc.keys.forEach((k,c)=>{if(!/^[\d\s.,:/+()%-]*$/.test(row[k]))add(`r${r}c${c}`,row[k]);}));
  return units;
}

export function translatedText(id,source,results) {
  return splitText(source).map((text,i)=>text.trim()?(results.get(`${id}_${i}`)??text):text).join('');
}

export function translatedDocument(doc,results,language) {
  return {...doc,paragraphs:doc.paragraphs.map(p=>({...p,text:translatedText(p.id,p.text,results)})),
    fields:doc.fields.map(f=>({...f,label:f.targetLabel||translatedText(`${f.id}l`,f.label,results),
      value:f.preserve?f.value:(f.kind==='name'?transliterate(f.value,language):translatedText(`${f.id}v`,f.value,results))})),
    columns:doc.columns.map((c,i)=>translatedText(`c${i}`,c,results)),
    items:doc.items.map((row,r)=>Object.fromEntries(doc.keys.map((k,c)=>[k,translatedText(`r${r}c${c}`,row[k],results)]))) };
}
