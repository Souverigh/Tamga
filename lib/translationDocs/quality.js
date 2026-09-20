const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

function tokens(value) {
  return String(value || '').match(TOKEN_PATTERN) || [];
}

function preservedTokenRatio(source, translated) {
  const sourceTokens = tokens(source).filter(token =>
    /\d/.test(token) || (/^[A-Z][A-Z0-9-]+$/.test(token) && token.length > 1)
  );
  if (!sourceTokens.length) return null;
  const target = String(translated || '');
  const preserved = sourceTokens.filter(token => target.includes(token)).length;
  return preserved / sourceTokens.length;
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function calculateDocumentQuality({ fields = [], paragraphs = [], tables = [], familyMembers = [] } = {}) {
  const populatedFields = fields.filter(field => String(field?.value || '').trim());
  const expectedFields = fields.length;
  const confidenceAverage = populatedFields.length
    ? populatedFields.reduce((sum, field) => sum + (Number.isFinite(field.confidence) ? field.confidence : 0), 0) / populatedFields.length
    : 0;
  const recognitionCompleteness = expectedFields ? populatedFields.length / expectedFields : 1;
  const lowConfidenceCount = populatedFields.filter(field => Number.isFinite(field.confidence) && field.confidence < 70).length;
  const recognitionScore = clamp(confidenceAverage * 0.8 + recognitionCompleteness * 20 - lowConfidenceCount * 3);

  const paragraphItems = paragraphs.filter(paragraph => String(paragraph?.text || '').trim());
  const translationItems = [
    ...populatedFields.map(field => ({ source: field.value, translated: field.translated })),
    ...paragraphItems.map(paragraph => ({ source: paragraph.text, translated: paragraph.translated })),
    ...tables.flatMap(table => (table.rows || []).flatMap(row => [
      { source: row.subject, translated: row.translatedSubject },
      { source: row.grade, translated: row.translatedGrade }
    ]).filter(item => String(item.source || '').trim())),
    // Таблица членов семьи ("Информация о составе семьи") — те же три колонки,
    // что и в исходнике; пустые исходные ячейки не считаются.
    ...familyMembers.flatMap(member => [
      { source: member.fullName, translated: member.translatedFullName },
      { source: member.relationship, translated: member.translatedRelationship },
      { source: member.birthDate, translated: member.translatedBirthDate }
    ]).filter(item => String(item.source || '').trim())
  ];
  const translatedItems = translationItems.filter(item => String(item.translated || '').trim());
  const completeness = translationItems.length ? translatedItems.length / translationItems.length : 1;
  const integrityRatios = translationItems
    .map(item => preservedTokenRatio(item.source, item.translated))
    .filter(ratio => ratio !== null);
  const integrity = integrityRatios.length
    ? integrityRatios.reduce((sum, ratio) => sum + ratio, 0) / integrityRatios.length
    : 1;
  const reviewCount = fields.filter(field => field.requiresReview).length;
  const translationScore = clamp(completeness * 60 + integrity * 40 - reviewCount * 5);

  return {
    recognition: {
      score: recognitionScore,
      populatedFields: populatedFields.length,
      totalFields: expectedFields,
      lowConfidenceFields: lowConfidenceCount
    },
    translation: {
      score: translationScore,
      translatedItems: translatedItems.length,
      totalItems: translationItems.length,
      preservedDataRatio: clamp(integrity * 100),
      fieldsRequiringReview: reviewCount
    },
    disclaimer: 'Оценка рассчитывается автоматически по уверенности распознавания, полноте перевода и сохранению чисел/идентификаторов. Это не заменяет проверку оригинала.'
  };
}

module.exports = { calculateDocumentQuality };
