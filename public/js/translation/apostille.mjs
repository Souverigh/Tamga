import { apostilleValue, localizeMarkers } from './field-rules.mjs';
// Never infer legal numbering from array positions or repair malformed input.
const keys = ['country', 'public_document', 'signatory_name', 'signatory_capacity', 'seal_authority', 'certified', 'certified_place', 'certified_date', 'certifying_authority', 'apostille_number', 'seal', 'signature'];
const numbers = ['1', '', '2', '3', '4', '', '5', '6', '7', '8', '9', '10'];
export function apostilleSignature(value, language) {
  return localizeMarkers(value, language);
}
export function validateApostille(elements, language, translated = false, { allowPendingReview = false } = {}) {
  const fail = (reason = 'Нарушена структура: нужны пункты 1–10 и два непронумерованных заголовка.') => {
    throw Object.assign(new Error(`Апостиль: ${reason}`), { status: 422, code: 'APOSTILLE_REVIEW_REQUIRED' });
  };
  if (!Array.isArray(elements)) fail('Нет структуры документа. Повторите распознавание после обновления страницы.');
  const typeOf = e => e.elementType || e.element_type || e.type;
  const fields = elements.filter(e => typeOf(e) !== 'stamp_text');
  if (fields.length !== 12 || new Set(elements.map(e => e.key)).size !== elements.length) fail();
  fields.forEach((e, i) => {
    if (e.key !== keys[i] || String(e.number || '') !== numbers[i]) fail(`Проверьте номер и порядок поля «${e.label || e.key}».`);
    const type = typeOf(e);
    if (numbers[i] ? type !== 'numbered_field' : !['section_text', 'unnumbered_section_heading'].includes(type)) fail(`Не определён тип строки «${e.label || e.key}». Обновите страницу и повторите распознавание.`);
    if (numbers[i] && /^(本公文|认证|This public document|Certified)$/i.test(e.targetLabel || e.label || '')) fail();
  });
  elements.forEach(e => {
    if (typeOf(e) === 'stamp_text' && e.number) fail();
    if (!translated) return;
    if (e.requiresReview && !e.reviewConfirmed && !allowPendingReview) fail(`Поле «${e.targetLabel || e.label || e.key}» требует сверки с оригиналом. Откройте сравнение и подтвердите проверку этого поля.`);
    const value = e.translated ?? e.value ?? '';
    const expected = e.sourceValue === undefined ? null : apostilleValue(e.key, e.sourceValue, language);
    if (expected && value !== expected.value) fail(`Поле «${e.targetLabel || e.label || e.key}»: перевод не соответствует оригиналу и правилам транслитерации/формата даты. Исправьте его в окне сравнения.`);
    if (language === 'zh' && /\bpechat\b/i.test(value)) fail('Замените Pechat на китайское обозначение печати в окне сравнения.');
    if (language === 'zh' && !['signatory_name', 'signature', 'certified_date', 'apostille_number'].includes(e.key) && value && value !== '[unclear]' && !/[\u3400-\u9fff]/u.test(value)) fail(`Поле «${e.targetLabel || e.label || e.key}» осталось без китайского перевода. Проверьте его в окне сравнения.`);
  });
  return elements;
}
