export const escapeXml = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const status = 'Машинный перевод, не проверен переводчиком';

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
  return paired ? pairedLayoutBlocks(original,translation) : layoutBlocks(translation);
}
const txtCell = c => (c && c.__bi) ? `${c.a} → ${c.b}` : String(c);
export function buildTranslationTxt(original,translation,paired) {
  return `${original.name}\n${status}\n\n`+buildBlocks(original,translation,paired).map(b=>b.table?b.table.map(row=>row.map(txtCell).join('\t')).join('\n'):(b.heading||b.text)).join('\n');
}
export function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function safeName(name) {return name.replace(/[\\/:*?"<>|\u0000-\u001F]/g,'_').slice(0,100)||'document';}
export function exportTxt(original,translation,paired) {
  downloadBlob(new Blob([buildTranslationTxt(original,translation,paired)],{type:'text/plain;charset=utf-8'}),safeName(original.name)+'-translation.txt');
}
const paragraph = (text,heading=false) => '<w:p><w:pPr><w:spacing w:before="'+(heading?'180':'0')+'" w:after="80" w:line="260" w:lineRule="auto"/><w:widowControl/>'+(heading?'<w:keepNext/>':'')+'</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="'+(heading?'24':'22')+'"/>'+(heading?'<w:b/>':'')+'</w:rPr><w:t xml:space="preserve">'+escapeXml(text).replace(/\r?\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>';
// A bilingual cell renders as two stacked paragraphs in the same table cell:
// the original at normal weight, the translated line beneath it in italic
// grey with a "→" marker — same convention as the print/screen view, so the
// exported document reads the same way it was reviewed.
const translatedRun = text => '<w:p><w:pPr><w:spacing w:before="20" w:after="80" w:line="260" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:i/><w:color w:val="555555"/></w:rPr><w:t xml:space="preserve">'+escapeXml(text).replace(/\r?\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>';
const cellXml = cell => (cell && cell.__bi) ? paragraph(cell.a)+translatedRun('→ '+cell.b) : paragraph(cell);
const table = rows => '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="single" w:sz="4" w:color="BBBBBB"/>`).join('')+'</w:tblBorders></w:tblPr>'+rows.map(row=>'<w:tr>'+row.map(cell=>'<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'+cellXml(cell)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
export function buildDocumentXml(original,translation,paired) {
  let body=paragraph(original.name,true)+paragraph(status);
  for (const b of buildBlocks(original,translation,paired)) body+=b.table?table(b.table):paragraph(b.heading||b.text,!!b.heading);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
}
export async function exportDocx(original,translation,paired) {
  if (!globalThis.JSZip) throw new Error('Модуль DOCX не загрузился. Обновите страницу.');
  const zip=new globalThis.JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml',buildDocumentXml(original,translation,paired));
  downloadBlob(await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),safeName(original.name)+'-translation.docx');
}
const cellHtml = cell => (cell && cell.__bi)
  ? escapeXml(cell.a)+'<br><span class="tr">→ '+escapeXml(cell.b)+'</span>'
  : escapeXml(cell);
export function buildPrintHtml(original,translation,paired) {
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Перевод</title><style>body{font:11pt Arial,sans-serif;line-height:1.3;margin:24px;color:#111}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 6pt;orphans:2;widows:2}h1{font-size:18pt}h2{font-size:14pt}h3{font-size:11pt;margin:14pt 0 6pt;break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed}td{border:1px solid #aaa;padding:6px;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top}.tr{color:#555;font-style:italic}h2{break-after:avoid}tr{break-inside:avoid}@page{size:A4;margin:18mm}@media print{button{display:none}}</style><h1>'+escapeXml(original.name)+'</h1><p>'+status+'</p>'+buildBlocks(original,translation,paired).map(b=>b.table?'<table>'+b.table.map(row=>'<tr>'+row.map(cell=>'<td>'+cellHtml(cell)+'</td>').join('')+'</tr>').join('')+'</table>':b.heading?'<h3>'+escapeXml(b.heading)+'</h3>':'<p>'+escapeXml(b.text)+'</p>').join('')+'</html>';
}
export function printTranslation(original,translation,paired) {
  const win=window.open('','_blank');
  if(!win)throw new Error('Разрешите открытие окна печати.');
  win.opener=null;win.document.write(buildPrintHtml(original,translation,paired));win.document.close();
  const button=win.document.createElement('button');button.textContent='Печать / сохранить PDF';button.onclick=()=>win.print();win.document.body.prepend(button);
}


