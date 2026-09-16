export function buildExportDocs(doc, language) {
  const visible = doc.result.doc_type === 'apostille'
    ? doc.result.fields
    : doc.result.fields.filter(f => f.value && f.value.trim());
  const name = doc.file.name;
  const original = {
    name,
    fields: visible.map(f => ({ label: f.label, value: f.value })),
    elements: Array.isArray(doc.result.elements)
      ? doc.result.elements.map(e => {
        const field = visible.find(f => f.key === e.key);
        return { number: e.number, label: e.label, value: field?.value ?? e.value ?? '' };
      })
      : undefined,
    columns: [], items: [], keys: [], paragraphs: []
  };
  const translation = {
    name,
    language,
    template: doc.result.doc_type === 'apostille' ? 'apostille' : undefined,
    fields: visible.map(f => ({ label: f.targetLabel || f.label, value: f.translated || '' })),
    elements: Array.isArray(doc.result.elements)
      ? doc.result.elements.map(e => {
        const field = visible.find(f => f.key === e.key);
        return {
          key: e.key,
          elementType: e.type ?? e.elementType ?? e.element_type,
          sourceValue: field?.value ?? e.sourceValue ?? e.value,
          number: e.number,
          label: field?.targetLabel || e.targetLabel || e.label,
          value: field?.translated ?? e.translated ?? ''
        };
      })
      : undefined,
    columns: [], items: [], keys: [], paragraphs: []
  };
  return { original, translation };
}
