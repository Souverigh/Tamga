// Экспорт результатов распознавания в JSON «как есть» — полная структура
// (поля, товарные строки, колонки) для интеграции клиентом в свои системы,
// без потерь по сравнению с CSV/Excel (там табличные типы сведены к плоским
// колонкам). Принимает уже готовые данные (массив групп, см. getFileGroups()
// в ui/results.js) — сам DOM не читает.

import { maskFields, maskItems } from './sensitiveFields.js';
import { columnsForType, keysForType } from '../config/docSchema.js';

// options.maskSensitive — см. sensitiveFields.js. По умолчанию выключено —
// не меняет поведение существующих вызовов без options (например, из старых
// интеграций, которые звали buildJson(groups) без второго аргумента).
export function buildJson(groups, { maskSensitive = false } = {}) {
  const payload = groups.map(({ fileName, docType, text, fields: rawFields, items: rawItems, columns, columnKeys, confidence, warnings }) => {
    const fields = maskFields(rawFields, maskSensitive);
    const items = maskItems(rawItems, columns || columnsForType(docType), columnKeys || keysForType(docType), maskSensitive);
    return {
      file: fileName,
      docType,
      // Самооценка модели (0-100, см. lib/confidence.js) — null, если её нет
      // (офлайн-режим или Gemini не смогла дать оценку); в JSON.stringify null
      // сериализуется как есть (в отличие от undefined ниже), т.к. это осмысленное
      // значение "оценки нет", а не отсутствующее в этой версии ответа поле.
      confidence: confidence === undefined ? null : confidence,
      text,
      // Пустые/неприменимые для типа поля не включаем — JSON.stringify сам
      // отбрасывает ключи со значением undefined.
      fields: fields && fields.length ? fields : undefined,
      items: items && items.length ? items : undefined,
      columns: columns || undefined,
      columnKeys: columnKeys || undefined,
      // Проверки бизнес-логики (см. postprocess/businessRules.js) — например,
      // "дата выдачи позже даты окончания". Отсутствует в объекте вовсе, если
      // проверять было нечего/замечаний нет — как и fields/items выше.
      warnings: warnings && warnings.length ? warnings : undefined
    };
  });
  return JSON.stringify(payload, null, 2);
}

export function downloadJson(groups, options) {
  if (groups.length === 0) return;
  const blob = new Blob([buildJson(groups, options)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `adre_${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
