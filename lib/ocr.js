// Распознавание текста (OCR) — независимый модуль.
// Единственная задача: инструкция для модели по извлечению текста как есть.
// Не знает ни про тип документа, ни про поля.

function buildOcrInstruction() {
  return 'Extract all text from this document exactly as written, preserving line breaks and layout. ' +
    'The document may mix Kyrgyz and Russian text — transcribe each accurately in its own script, ' +
    'including Kyrgyz-specific letters (Ң, Ө, Ү).';
}

function ocrSchemaField() {
  return { text: { type: 'STRING' } };
}

module.exports = { buildOcrInstruction, ocrSchemaField };
