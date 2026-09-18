// Only recover explicit subject/grade pairs. Never zip separate columns or
// partially consume a field: ambiguous legacy text stays available as a field.
function legacyTables(fieldsByKey) {
  return ['subjectsAndGrades', 'finalExamsAndGrades'].flatMap(key => {
    const field = fieldsByKey[key];
    const lines = (field?.value || '').split(/\r?\n|;/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const rows = lines.map(line => {
      const match = line.match(/^(.+?)(?:\s*[\t|:]\s*|\s+[—–-]\s+)([^\t|:]*?)$/u);
      if (!match || !match[1].trim()) return null;
      return { subject: match[1].trim(), grade: match[2].trim(), confidence: field.confidence, raw_text: line };
    });
    return rows.every(Boolean) ? [{ section: field.label, rows }] : [];
  });
}

module.exports = { legacyTables };
