// Извлечение структурированных полей по regex-паттернам — офлайн-режим (без Gemini).
// Независимый модуль: не знает, как определяется тип документа (см. classification/) —
// только принимает готовый docType и текст, возвращает набор полей под этот тип.
// Заведомо менее надёжна, чем извлечение через Gemini; поля, которые не удалось
// найти, остаются пустыми — заполняются вручную в интерфейсе.

import { DOC_FIELDS } from '../config/docSchema.js';

export function extractFieldsHeuristic(text, docType) {
  const fieldNames = DOC_FIELDS[docType] || DOC_FIELDS['Другое'];
  const dateMatches = [...text.matchAll(/\b\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\b/g)].map(m => m[0]);
  const amountMatches = [...text.matchAll(/\b\d{1,3}(?:[ .,]\d{3})*(?:[.,]\d{2})?\s?(?:сом|KGS|руб|₽|\$|USD)\b/gi)].map(m => m[0]);
  const idMatches = [...text.matchAll(/\b[A-ZА-Я]{1,3}\s?\d{6,9}\b/g)].map(m => m[0]);
  const ibanMatches = [...text.matchAll(/\bKG\d{2}[A-Z0-9]{16,20}\b/gi)].map(m => m[0]);

  let dateIdx = 0, amountIdx = 0;

  return fieldNames.map(label => {
    const l = label.toLowerCase();
    let value = '';
    if (l.includes('дата')) {
      value = dateMatches[dateIdx] || '';
      if (value) dateIdx++;
    } else if (l.includes('сумма')) {
      value = amountMatches[amountIdx] || '';
      if (value) amountIdx++;
    } else if (l.includes('iban') || l.includes('счёт')) {
      value = ibanMatches[0] || '';
    } else if (l.includes('серия') || l.includes('номер') || l.includes('пин') || l.includes('инн')) {
      value = idMatches[0] || '';
    }
    return { label, value };
  });
}
