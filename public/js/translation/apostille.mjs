// Never infer legal numbering from array positions or repair malformed input.
const keys = ['country', 'public_document', 'signatory_name', 'signatory_capacity', 'seal_authority', 'certified', 'certified_place', 'certified_date', 'certifying_authority', 'apostille_number', 'seal', 'signature'];
const numbers = ['1', '', '2', '3', '4', '', '5', '6', '7', '8', '9', '10'];
export function apostilleSignature(value, language) {
  return language === 'zh' ? value.replace(/\[signature\]/g, '[签字]') : value;
}
export function validateApostille(elements, language, translated = false) {
  const fail = () => { throw new Error('Invalid apostille: structure or content requires review before export.'); };
  if (!Array.isArray(elements)) fail();
  const fields = elements.filter(e => (e.elementType || e.element_type) !== 'stamp_text');
  if (fields.length !== 12 || new Set(elements.map(e => e.key)).size !== elements.length) fail();
  fields.forEach((e, i) => {
    if (e.key !== keys[i] || String(e.number || '') !== numbers[i]) fail();
    const type = e.elementType || e.element_type;
    if (numbers[i] ? type !== 'numbered_field' : !['section_text', 'unnumbered_section_heading'].includes(type)) fail();
    if (numbers[i] && /^(本公文|认证|This public document|Certified)$/i.test(e.targetLabel || e.label || '')) fail();
  });
  elements.forEach(e => {
    if ((e.elementType || e.element_type) === 'stamp_text' && e.number) fail();
    if (!translated) return;
    const value = e.translated ?? e.value ?? '';
    if (['signatory_name', 'certified_date', 'apostille_number', 'signature'].includes(e.key) && e.sourceValue !== undefined && value !== (e.key === 'signature' ? apostilleSignature(e.sourceValue, language) : e.sourceValue)) fail();
    if (language === 'zh' && /\bpechat\b/i.test(value)) fail();
    if (language === 'zh' && !['signatory_name', 'signature', 'certified_date', 'apostille_number'].includes(e.key) && value && value !== '[unclear]' && !/[\u3400-\u9fff]/u.test(value)) fail();
  });
  return elements;
}
