// Распознавание через Gemini идёт через собственный бекенд (/api/recognize) —
// ключ Google не хранится и не вводится в браузере, см. api/recognize.js и lib/recognize.js.
// Если presetDocType передан (пользователь выбрал тип вручную), бекенд пропускает
// классификацию и сразу извлекает поля под этот тип — см. lib/recognize.js.

import { pageImageToBase64 } from '../ocr/imageLoader.js';

export async function recognizeWithGemini(pageImage, presetDocType) {
  const base64 = pageImageToBase64(pageImage);
  const body = { image: base64, mimeType: 'image/png' };
  if (presetDocType) body.docType = presetDocType;

  const res = await fetch('/api/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let data;
  try { data = await res.json(); } catch (_) { data = null; }

  if (!res.ok) {
    throw new Error(data?.error || `Сервер распознавания вернул ошибку ${res.status}`);
  }

  return {
    text: data.text || '',
    docType: data.documentType || 'Другое',
    fields: Array.isArray(data.fields) && data.fields.length ? data.fields : null,
    items: Array.isArray(data.items) && data.items.length ? data.items : null
  };
}
