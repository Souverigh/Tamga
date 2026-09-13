export const escapeXml = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const status = 'Машинный перевод, не проверен переводчиком';

export function documentBlocks(doc) {
  const blocks = [];
  if (doc.fields.length) blocks.push({table:doc.fields.map(f=>[f.label,f.value])});
  if (doc.columns.length && doc.items.length) blocks.push({table:[doc.columns,...doc.items.map(row=>doc.keys.map(k=>row[k]))]});
  doc.paragraphs.forEach(p=>blocks.push({text:p.text}));
  return blocks;
}
function sections(original,translation,paired) {
  return [...(paired?[{title:'Оригинал — распознанные данные',doc:original}]:[]),{title:'Перевод',doc:translation}];
}
export function buildTranslationTxt(original,translation,paired) {
  return `${original.name}\n${status}\n\n`+sections(original,translation,paired).map(s=>s.title+'\n'+documentBlocks(s.doc).map(b=>b.table?b.table.map(row=>row.join('\t')).join('\n'):b.text).join('\n')).join('\n\n');
}
export function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function safeName(name) {return name.replace(/[\\/:*?"<>|\u0000-\u001F]/g,'_').slice(0,100)||'document';}
export function exportTxt(original,translation,paired) {
  downloadBlob(new Blob([buildTranslationTxt(original,translation,paired)],{type:'text/plain;charset=utf-8'}),safeName(original.name)+'-translation.txt');
}
const paragraph = text => '<w:p><w:pPr><w:spacing w:after="100"/></w:pPr><w:r><w:t xml:space="preserve">'+escapeXml(text).replace(/\r?\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>';
const table = rows => '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="single" w:sz="4" w:color="BBBBBB"/>`).join('')+'</w:tblBorders></w:tblPr>'+rows.map(row=>'<w:tr>'+row.map(cell=>'<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'+paragraph(cell)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
export function buildDocumentXml(original,translation,paired) {
  let body=paragraph(original.name)+paragraph(status);
  for (const s of sections(original,translation,paired)) {
    body+=paragraph(s.title);
    for (const b of documentBlocks(s.doc)) body+=b.table?table(b.table):paragraph(b.text);
  }
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
export function buildPrintHtml(original,translation,paired) {
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Перевод</title><style>body{font:12pt Arial,sans-serif;line-height:1.45;margin:24px;color:#111}p{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;table-layout:fixed}td{border:1px solid #aaa;padding:6px;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top}h2{break-after:avoid}tr{break-inside:avoid}@page{size:A4;margin:18mm}@media print{button{display:none}}</style><h1>'+escapeXml(original.name)+'</h1><p>'+status+'</p>'+sections(original,translation,paired).map(s=>'<h2>'+s.title+'</h2>'+documentBlocks(s.doc).map(b=>b.table?'<table>'+b.table.map(row=>'<tr>'+row.map(cell=>'<td>'+escapeXml(cell)+'</td>').join('')+'</tr>').join('')+'</table>':'<p>'+escapeXml(b.text)+'</p>').join('')).join('')+'</html>';
}
export function printTranslation(original,translation,paired) {
  const win=window.open('','_blank');
  if(!win)throw new Error('Разрешите открытие окна печати.');
  win.opener=null;win.document.write(buildPrintHtml(original,translation,paired));win.document.close();
  const button=win.document.createElement('button');button.textContent='Печать / сохранить PDF';button.onclick=()=>win.print();win.document.body.prepend(button);
}
