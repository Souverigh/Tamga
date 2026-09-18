export function buildExportDocs(doc, language) {
  const visible = doc.result.doc_type === 'apostille'
    ? doc.result.fields
    : doc.result.fields.filter(f => f.value && f.value.trim());
  // "Другое" и клиентские типы без предопределённых полей несут структуру
  // документа в doc.result.paragraphs (см. lib/translationDocs/pipeline.js,
  // 17 сен 2026 — "максимально сохранить структуру, ничего не менять, но
  // переводить всё"), а не в одном поле-заглушке. pairedLayoutBlocks в
  // export.mjs уже умеет рендерить original/translation.paragraphs бок о
  // бок — просто раньше сюда всегда попадал пустой массив.
  const paragraphs = Array.isArray(doc.result.paragraphs) ? doc.result.paragraphs : [];
  const tables = Array.isArray(doc.result.tables) ? doc.result.tables : [];
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
    columns: [], items: [], keys: [], paragraphs: paragraphs.map(p => ({ text: p.text })),
    tables: tables.map(table => ({ section: table.section, rows: table.rows.map(row => ({ subject: row.subject, grade: row.grade })) }))
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
          requiresReview: field?.requiresReview ?? e.requiresReview,
          reviewConfirmed: !!field && field.reviewedSource === field.value && field.reviewedTranslation === field.translated,
          number: e.number,
          label: field?.targetLabel || e.targetLabel || e.label,
          value: field?.translated ?? e.translated ?? ''
        };
      })
      : undefined,
    columns: [], items: [], keys: [], paragraphs: paragraphs.map(p => ({ text: p.translated || '' })),
    tables: tables.map(table => ({ section: table.section, rows: table.rows.map(row => ({ subject: row.translatedSubject, grade: row.translatedGrade })) }))
  };
  return { original, translation };
}
