// Маскирование чувствительных полей при экспорте — премиум-опция (Ethan,
// 7 сен 2026): клиент часто передаёт скачанный файл дальше третьим лицам
// (бухгалтеру, партнёру), и не всегда там уместно светить номер документа
// или ПИН/ИНН целиком. Это ТОЛЬКО опция экспорта — на сам результат
// распознавания в интерфейсе (где клиент и так должен видеть/проверить
// данные) не влияет, маскируется только то, что уходит в скачиваемый файл.
//
// Список меток — по ТОЧНОМУ совпадению с подписью поля (см. lib/docSchema.js/
// public/js/config/docSchema.js). Ограничение: если у клиента настроен
// field_overrides с другими названиями подписей (см. customFieldsLookup.js),
// эти переименованные поля сюда не попадут — список статичный, не читает
// конфиг клиента. Для MVP-версии это приемлемо (см. обсуждение в TECH_DEBT.md
// про порядок фич); специфичный список per-client — уже отдельная доработка.
export const SENSITIVE_LABELS = new Set([
  'ПИН (ИНН)',
  'Серия и номер',           // паспорт, права, военный билет, свидетельства ЗАГС, техпаспорт, недвижимость
  'Номер счёта / IBAN',
  'Счёт получателя',
  'VIN',
  'Кадастровый номер'
]);

// Оставляет видимыми последние 4 символа, остальное — точками. Короткие
// значения (≤4 символов) маскируются целиком — иначе "видимый остаток" был
// бы длиннее самого значения и маскировка не давала бы вообще ничего скрыть.
export function maskValue(value) {
  const s = value == null ? '' : String(value).trim();
  if (!s) return s;
  if (s.length <= 4) return '•'.repeat(s.length);
  return '•'.repeat(s.length - 4) + s.slice(-4);
}

// fields — массив {label, value} (см. getFileGroups() в ui/results.js).
// enabled=false — возвращает fields как есть (без копирования), чтобы
// вызывающему коду не нужно было отдельно ветвиться на "опция выключена".
export function maskFields(fields, enabled) {
  if (!enabled || !Array.isArray(fields)) return fields;
  return fields.map(f => SENSITIVE_LABELS.has(f.label) ? { ...f, value: maskValue(f.value) } : f);
}

// items — товарные строки табличного типа, columns/keys — раскладка колонок
// ЭТОЙ группы (см. resolveTableColumns на сервере) — нужны оба массива в паре,
// т.к. по columns[i] определяем чувствительность, а маскируем keys[i] в item.
// На практике колонки табличных типов (накладная, счёт-фактура и т.п.) сейчас
// не пересекаются со SENSITIVE_LABELS вообще — функция здесь на будущее,
// если появится табличный тип с колонкой вроде "Серия и номер".
export function maskItems(items, columns, keys, enabled) {
  if (!enabled || !Array.isArray(items) || !columns || !keys) return items;
  const sensitiveIdx = keys.filter((_, i) => SENSITIVE_LABELS.has(columns[i]));
  if (!sensitiveIdx.length) return items;
  return items.map(item => {
    const out = { ...item };
    keys.forEach((k, i) => { if (SENSITIVE_LABELS.has(columns[i])) out[k] = maskValue(out[k]); });
    return out;
  });
}
