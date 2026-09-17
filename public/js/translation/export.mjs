import { validateApostille } from './apostille.mjs';
import { LANGUAGES } from './model.mjs';
export const escapeXml = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');

// Стандартная концовка "под нотариальное заверение" (Ethan, 17 сен 2026 —
// со скриншота идеи "автоформирование концовки для переводчиков: ФИО
// переводчика, языковая пара, место для подписи"). Опциональна — блоков нет
// вообще, если ФИО переводчика не задано (нет смысла печатать пустую
// формулировку). ФИО хранится в client-settings (formatting.translatorName,
// см. api/client-settings.js) и подставляется панелью автоматически, но
// клиент может переопределить его перед конкретным экспортом.
// Родительный падеж "с ... на ..." по-русски зависит от языка (из
// латиницы/кириллицы то и дело меняется склонение) — вместо конструирования
// грамматически верной фразы на 8 языков просто указываем два языка отдельными
// строками, это однозначно и не требует словаря склонений.
export function certificationBlocks({ translatorName, sourceLanguage } = {}, targetLanguage) {
  const name = String(translatorName || '').trim();
  if (!name) return [];
  const sourceLabel = LANGUAGES[sourceLanguage] || sourceLanguage || '—';
  const targetLabel = LANGUAGES[targetLanguage] || targetLanguage || '—';
  const today = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  return [
    { heading: 'Удостоверение переводчика' },
    { text: `Язык оригинала: ${sourceLabel}. Язык перевода: ${targetLabel}.` },
    { text: `Переводчик: ${name}` },
    { text: `Дата: ${today}` },
    { text: 'Подпись: _______________________' }
  ];
}

export function documentBlocks(doc) {
  const blocks = [];
  if (doc.fields.length) blocks.push({table:doc.fields.map(f=>[f.label,f.value])});
  if (doc.columns.length && doc.items.length) blocks.push({table:[doc.columns,...doc.items.map(row=>doc.keys.map(k=>row[k]))]});
  doc.paragraphs.forEach(p=>blocks.push({text:p.text}));
  return blocks;
}
// Presentation only: retain every text fragment; remove redundant empty OCR
// lines from layout rather than treating them as Word line breaks plus margins.
export function layoutBlocks(doc) {
  const blocks=[];
  if(doc.fields.length)blocks.push({heading:'Реквизиты'},{table:doc.fields.map(f=>[f.label,f.value])});
  if(doc.columns.length&&doc.items.length)blocks.push({heading:'Табличные данные'},{table:[doc.columns,...doc.items.map(row=>doc.keys.map(k=>row[k]))]});
  const paragraphs=doc.paragraphs.flatMap(p=>String(p.text).split(/\r?\n\s*\r?\n/).map(text=>text.trim()).filter(Boolean));
  if(paragraphs.length)blocks.push({heading:'Полный текст распознавания — включая дополнительные отметки'},...paragraphs.map(text=>({text})));
  return blocks;
}

export function apostilleConvention(language) {
  return {
    ru: '(Гаагская конвенция от 5 октября 1961 года)',
    ky: '(Гаага конвенциясы, 1961-жылдын 5-октябры)',
    en: '(Convention de La Haye du 5 octobre 1961)',
    kk: '(1961 жылғы 5 қазандағы Гаага конвенциясы)',
    uz: '(1961-yil 5-oktabrdagi Gaaga konventsiyasi)',
    tr: '(5 Ekim 1961 tarihli Lahey Sözleşmesi)',
    zh: '(1961年10月5日《海牙公约》)',
    de: '(Haager Übereinkommen vom 5. Oktober 1961)'
  }[language] || '(Convention de La Haye du 5 octobre 1961)';
}

function apostilleBlocks(doc) {
  const elements = validateApostille(doc.elements, doc.language, true);
  const row = element => [
    element.number ? `${element.number}. ${element.label || ''}` : (element.label || ''),
    element.value || ''
  ];
  const fields = elements.filter(e => e.elementType !== 'stamp_text');
  return [
    { title: 'APOSTILLE', subtitle: apostilleConvention(doc.language),
      table: fields.map(row), widths: [3010, 6628], apostille: true },
    ...elements.filter(e => e.elementType === 'stamp_text').map(e => ({ text: `${doc.language === 'zh' ? '印章文字：' : 'Seal text: '}${e.value || ''}` }))
  ];
}

// Bilingual cell: original and translated value shown together, never one
// replacing the other. Used only where doubling the column count would make
// an already-wide table unreadable (line-item tables); requisites and running
// text get real side-by-side columns instead (see pairedLayoutBlocks below).
const bi = (a,b) => ({__bi:true, a:String(a??''), b:String(b??'')});

// Same shape as layoutBlocks, but merges original+translation into ONE set of
// blocks instead of two stacked documents — this is what a notarial-style
// bilingual translation actually looks like (source and target read side by
// side, not one after the other). Rows are always paired by array index:
// buildDocument/translatedDocument never add, drop or reorder fields, items
// or paragraphs, so original.fields[i]/translation.fields[i] (same for
// items/paragraphs) are always the same field — nothing can misalign here.
export function pairedLayoutBlocks(original,translation) {
  const blocks=[];
  if(original.fields.length){
    blocks.push({heading:'Реквизиты'});
    blocks.push({table:[['Поле','Оригинал','Перевод'],...original.fields.map((f,i)=>{
      const t=translation.fields[i];
      return [t.targetLabel||t.label,f.value,t.value];
    })]});
  }
  if(original.columns.length&&original.items.length){
    blocks.push({heading:'Табличные данные'});
    blocks.push({table:[
      original.columns.map((c,i)=>bi(c,translation.columns[i])),
      ...original.items.map((row,r)=>original.keys.map((k,c)=>bi(row[k],translation.items[r][original.keys[c]])))
    ]});
  }
  const rows=original.paragraphs
    .map((p,i)=>[p.text,translation.paragraphs[i].text])
    .filter(([a])=>a.trim());
  if(rows.length){
    blocks.push({heading:'Полный текст распознавания — включая дополнительные отметки'});
    blocks.push({table:[['Оригинал','Перевод'],...rows]});
  }
  return blocks;
}

function buildBlocks(original,translation,paired) {
  if (translation.template === 'apostille') validateApostille(translation.elements, translation.language, true);
  if (!paired && translation.template === 'apostille') return apostilleBlocks(translation);
  return paired ? pairedLayoutBlocks(original,translation) : layoutBlocks(translation);
}
const txtCell = c => (c && c.__bi) ? `${c.a} → ${c.b}` : String(c);
export function buildTranslationTxt(original,translation,paired,certification) {
  const title = paired ? original.name : (translation.template === 'apostille' ? 'APOSTILLE' : translation.name);
  const blocks = [...buildBlocks(original,translation,paired), ...certificationBlocks(certification, translation.language)];
  return `${title}\n\n`+blocks.map(b=>(b.subtitle ? b.subtitle+'\n' : '')+(b.table?b.table.map(row=>row.map(txtCell).join('\t')).join('\n'):(b.heading||b.text))).join('\n');
}
export function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function safeName(name) {return name.replace(/[\\/:*?"<>|\u0000-\u001F]/g,'_').slice(0,100)||'document';}
export function exportTxt(original,translation,paired,certification) {
  downloadBlob(new Blob([buildTranslationTxt(original,translation,paired,certification)],{type:'text/plain;charset=utf-8'}),safeName(original.name)+'-translation.txt');
}
const paragraph = (text,heading=false) => '<w:p><w:pPr><w:spacing w:before="'+(heading?'180':'0')+'" w:after="80" w:line="260" w:lineRule="auto"/><w:widowControl/>'+(heading?'<w:keepNext/>':'')+'</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="SimSun"/><w:sz w:val="'+(heading?'24':'22')+'"/>'+(heading?'<w:b/>':'')+'</w:rPr><w:t xml:space="preserve">'+escapeXml(text).replace(/\r?\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>';
// A bilingual cell renders as two stacked paragraphs in the same table cell:
// the original at normal weight, the translated line beneath it in italic
// grey with a "→" marker — same convention as the print/screen view, so the
// exported document reads the same way it was reviewed.
const translatedRun = text => '<w:p><w:pPr><w:spacing w:before="20" w:after="80" w:line="260" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="SimSun"/><w:sz w:val="20"/><w:i/><w:color w:val="555555"/></w:rPr><w:t xml:space="preserve">'+escapeXml(text).replace(/\r?\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>';
const cellXml = cell => (cell && cell.__bi) ? paragraph(cell.a)+translatedRun('→ '+cell.b) : paragraph(cell);
const alignedParagraph = (text, heading = false, center = false) => paragraph(text, heading).replace('<w:pPr>', '<w:pPr>'+(center ? '<w:jc w:val="center"/>' : ''));
const table = (rows, widths, options = {}) => {
  const properties = widths
    ? '<w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
    : '<w:tblW w:w="0" w:type="auto"/>';
  const grid = widths ? '<w:tblGrid>'+widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('')+'</w:tblGrid>' : '';
  const borders = ['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="${options.borderless ? 'nil' : 'single'}" w:sz="4" w:color="000000"/>`).join('');
  const header = options.title ? '<w:tr><w:tc><w:tcPr><w:tcW w:w="9638" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr>'+alignedParagraph(options.title,true,true)+alignedParagraph(options.subtitle,true,true)+'</w:tc></w:tr>' : '';
  const body = rows.map(row=>'<w:tr><w:trPr><w:cantSplit/></w:trPr>'+row.map((cell,index)=>'<w:tc><w:tcPr>'+(widths ? `<w:tcW w:w="${widths[index]}" w:type="dxa"/>` : '<w:tcW w:w="0" w:type="auto"/>')+'<w:vAlign w:val="center"/></w:tcPr>'+(options.apostille ? alignedParagraph(cell, false, index === 1) : cellXml(cell))+'</w:tc>').join('')+'</w:tr>').join('');
  return '<w:tbl><w:tblPr>'+properties+'<w:tblBorders>'+borders+'</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>'+grid+header+body+'</w:tbl>';
};
export function buildDocumentXml(original,translation,paired,certification) {
  const title = paired ? original.name : (translation.template === 'apostille' ? 'APOSTILLE' : translation.name);
  let body=!paired && translation.template === 'apostille' ? '' : paragraph(title,true);
  const blocks = [...buildBlocks(original,translation,paired), ...certificationBlocks(certification, translation.language)];
  for (const b of blocks) body+=b.table?table(b.table,b.widths,b):paragraph(b.heading||b.text,!!b.heading);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
export async function exportDocx(original,translation,paired,certification) {
  if (!globalThis.JSZip) throw new Error('Модуль DOCX не загрузился. Обновите страницу.');
  const zip=new globalThis.JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml',buildDocumentXml(original,translation,paired,certification));
  downloadBlob(await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),safeName(original.name)+'-translation.docx');
}
const cellHtml = cell => (cell && cell.__bi)
  ? escapeXml(cell.a)+'<br><span class="tr">→ '+escapeXml(cell.b)+'</span>'
  : escapeXml(cell);
export function buildTranslationHtmlBody(original, translation, paired, certification) {
  const title = !paired && translation.template === 'apostille' ? '' : '<h1>'+escapeXml(original.name)+'</h1>';
  const blocks = [...buildBlocks(original,translation,paired), ...certificationBlocks(certification, translation.language)];
  return title+blocks.map(b => {
    if (!b.table) return b.heading ? '<h3>'+escapeXml(b.heading)+'</h3>' : '<p>'+escapeXml(b.text)+'</p>';
    const header = b.title ? '<tr><td colspan="2" style="text-align:center;font-size:16pt;font-weight:bold">'+escapeXml(b.title)+'<br>'+escapeXml(b.subtitle)+'</td></tr>' : '';
    const cols = b.widths ? '<colgroup>'+b.widths.map(w=>`<col style="width:${w/9638*100}%">`).join('')+'</colgroup>' : '';
    return (b.apostille ? '<table style="width:100%;border-collapse:collapse;table-layout:fixed">' : '<table>')+cols+header+b.table.map(row=>'<tr>'+row.map((cell,i)=>'<td style="border:'+(b.borderless?'0':'1px solid #111')+';padding:7px;vertical-align:middle;white-space:pre-wrap;overflow-wrap:anywhere;text-align:'+(b.apostille && i === 1?'center':'left')+'">'+cellHtml(cell)+'</td>').join('')+'</tr>').join('')+'</table>';
  }).join('');
}
export function buildPrintHtml(original,translation,paired,certification) {
  return '<!doctype html><html lang="'+escapeXml(translation.language || 'ru')+'"><meta charset="utf-8"><title>Translation</title><style>body{font:11pt Arial,sans-serif;line-height:1.3;margin:24px;color:#111}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:6pt 0}h1{font-size:18pt}h3{font-size:11pt;margin:14pt 0 6pt}table{width:100%;border-collapse:collapse;table-layout:fixed}td{border:1px solid #111;padding:7px}.tr{color:#555;font-style:italic}tr{break-inside:avoid}@page{size:A4;margin:18mm}</style>'+buildTranslationHtmlBody(original,translation,paired,certification)+'</html>';
}
export function printTranslation(original,translation,paired,certification) {
  const win=window.open('','_blank');
  if(!win)throw new Error('Разрешите открытие окна печати.');
  win.opener=null;win.document.write(buildPrintHtml(original,translation,paired,certification));win.document.close();
  const button=win.document.createElement('button');button.textContent='Печать / сохранить PDF';button.onclick=()=>win.print();win.document.body.prepend(button);
}

export async function downloadTranslationPdf(translation,certification) {
  if (translation.template === 'apostille') validateApostille(translation.elements, translation.language, true);
  if (!globalThis.html2canvas || !globalThis.jspdf?.jsPDF) {
    throw new Error('Модуль PDF не загрузился. Обновите страницу и повторите попытку.');
  }
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:720px;padding:44px;background:#fff;color:#111;font:16px Arial,sans-serif;line-height:1.35;';
  if (translation.template === 'apostille') {
    container.innerHTML = buildTranslationHtmlBody(translation, translation, false, certification);
  } else {
    const title = document.createElement('h1');
    title.textContent = translation.name;
    container.append(title);
    const tableEl = document.createElement('table');
    tableEl.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;';
    (translation.fields || []).forEach(field => {
      const row = document.createElement('tr');
      [field.label, field.value || ''].forEach(text => {
        const cell = document.createElement('td');
        cell.textContent = text;
        cell.style.cssText = 'border:1px solid #777;padding:10px;vertical-align:top;overflow-wrap:anywhere;';
        row.append(cell);
      });
      tableEl.append(row);
    });
    container.append(tableEl);
    const footer = document.createElement('div');
    footer.innerHTML = certificationBlocks(certification, translation.language)
      .map(b => b.heading ? `<h3 style="font-size:14px;margin:18px 0 6px">${escapeXml(b.heading)}</h3>` : `<p style="margin:4px 0">${escapeXml(b.text)}</p>`)
      .join('');
    container.append(footer);
  }
  document.body.append(container);
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#fff' });
    const { jsPDF } = globalThis.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 30;
    const width = 595.28 - margin * 2;
    const height = 841.89 - margin * 2;
    const scale = width / canvas.width;
    const pageHeight = Math.floor(height / scale);
    let offset = 0;
    let first = true;
    while (offset < canvas.height) {
      const sliceHeight = Math.min(pageHeight, canvas.height - offset);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceHeight;
      slice.getContext('2d').drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', margin, margin, width, sliceHeight * scale);
      first = false;
      offset += sliceHeight;
    }
    const name = safeName(translation.name || 'translation').replace(/\.[^.]+$/, '');
    pdf.save(`${name}-translation.pdf`);
  } finally {
    container.remove();
  }
}
