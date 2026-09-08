// Общие валидаторы для полей/типов/бизнес-правил клиента — вынесены сюда,
// чтобы не дублировать одну и ту же логику в api/admin/clients.js (Ethan,
// полный доступ ко всем клиентам) и api/client-settings.js (сам клиент,
// доступ только к своей строке, 8 сен 2026: "чтобы клиенты сами меняли
// поля/добавляли типы/настраивали бизнес-правила"). Дублирование именно
// этой логики уже один раз привело к реальному багу (см. TECH_DEBT.md,
// 8 сен 2026): businessRules добавили в customFieldsLookup.js (чтение), но
// забыли добавить в validateAndNormalize (запись) — сохранение клиента
// БЕЗ других полей formatting (дата/разделитель/приоритет/вебхук) тихо
// стирало его же бизнес-правила. Один общий модуль вместо двух копий —
// чтобы новая настройка не могла повторить ту же ошибку по забывчивости.

const { DOC_TYPES } = require('./docSchema');

// value — то, что пришло в body.field_overrides. Возвращает { error } | { value }.
// value в успехе — либо null (ничего не задано), либо объект вида
// { "Стандартный тип": ["Поле1", "Поле2"] } — для табличных типов массив
// значений это НАЗВАНИЯ КОЛОНОК, не подписи полей (см. lib/extraction.js:
// resolveTableColumns), но формат хранения один и тот же.
function validateFieldOverrides(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Переопределение полей должно быть объектом вида { "Название стандартного типа": ["Поле1", "Поле2"] }' };
  }
  for (const [type, fields] of Object.entries(value)) {
    if (!DOC_TYPES.includes(type)) {
      return { error: `"${type}" не входит в стандартный список типов документов` };
    }
    if (!Array.isArray(fields) || !fields.every(f => typeof f === 'string') || !fields.length) {
      return { error: `Поля для "${type}" должны быть непустым списком названий` };
    }
  }
  return { value: Object.keys(value).length ? value : null };
}

// value — то, что пришло в body.custom_doc_types. Возвращает { error } | { value }.
function validateCustomDocTypes(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Кастомные типы должны быть объектом вида { "Название типа": { "fields": ["Поле1"], "hint": "..." } }' };
  }
  for (const [type, entry] of Object.entries(value)) {
    if (DOC_TYPES.includes(type)) {
      return { error: `"${type}" совпадает со стандартным типом — используйте переопределение полей вместо кастомного типа с тем же именем` };
    }
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.fields) || !entry.fields.every(f => typeof f === 'string') || !entry.fields.length) {
      return { error: `Поля для типа "${type}" должны быть непустым списком названий` };
    }
    if (entry.hint !== undefined && entry.hint !== null && typeof entry.hint !== 'string') {
      return { error: `Подсказка для типа "${type}" должна быть строкой` };
    }
  }
  return { value: Object.keys(value).length ? value : null };
}

// value — то, что пришло в body.formatting.businessRules (или откуда угодно,
// откуда клиент присылает список правил). Единственный поддерживаемый тип —
// percentage_match (Ethan, 7 сен 2026: конструктор из готовых типов, не
// свободные формулы клиента — см. public/js/postprocess/businessRules.js).
// Возвращает { error } | { value } — value: [] или null, если правил нет
// (пустой массив — валидный результат "правил нет", в отличие от
// field_overrides/custom_doc_types, где отсутствие настройки — null; здесь
// [] используется, чтобы вызывающий код мог явно отличить "было и стёрли"
// от "не трогали вовсе" при слиянии с существующим formatting — см.
// api/client-settings.js).
function validateBusinessRules(value) {
  if (value === undefined || value === null || value === '') return { value: [] };
  if (!Array.isArray(value)) {
    return { error: 'Бизнес-правила должны быть списком' };
  }
  const cleaned = [];
  for (const rule of value) {
    if (!rule || typeof rule !== 'object') {
      return { error: 'Каждое бизнес-правило должно быть объектом' };
    }
    if (rule.type !== 'percentage_match') {
      return { error: `Неподдерживаемый тип правила: "${rule.type}" (поддерживается только percentage_match)` };
    }
    if (typeof rule.baseField !== 'string' || !rule.baseField.trim()) {
      return { error: 'У бизнес-правила не задано поле-база' };
    }
    if (typeof rule.valueField !== 'string' || !rule.valueField.trim()) {
      return { error: 'У бизнес-правила не задано проверяемое поле' };
    }
    const expectedPercent = Number(rule.expectedPercent);
    if (!Number.isFinite(expectedPercent)) {
      return { error: `Ожидаемый процент для правила "${rule.baseField} / ${rule.valueField}" должен быть числом` };
    }
    let tolerancePercent = 1;
    if (rule.tolerancePercent !== undefined && rule.tolerancePercent !== null && rule.tolerancePercent !== '') {
      const t = Number(rule.tolerancePercent);
      if (!Number.isFinite(t) || t < 0 || t > 50) {
        return { error: `Допуск для правила "${rule.baseField} / ${rule.valueField}" должен быть числом от 0 до 50` };
      }
      tolerancePercent = t;
    }
    cleaned.push({
      type: 'percentage_match',
      baseField: rule.baseField.trim(),
      valueField: rule.valueField.trim(),
      expectedPercent,
      tolerancePercent,
      level: rule.level === 'info' ? 'info' : 'error'
    });
  }
  return { value: cleaned };
}

// Брендинг (логотип/название/цвет) — Ethan, 8 сен 2026: клиенты сами могут
// менять свой брендинг через самообслуживание. logoUrl обязательно https —
// та же логика, что у webhookUrl (см. api/admin/clients.js): подставляется
// в HTML сайта клиента, http-адрес по смешанному контенту браузер всё равно
// заблокирует на HTTPS-сайте. accentColor — HEX-цвет вида #RRGGBB.
function validateBranding({ displayName, logoUrl, accentColor }) {
  const result = {};
  if (displayName !== undefined) {
    if (displayName === null || displayName === '') {
      result.displayName = null;
    } else if (typeof displayName !== 'string' || displayName.length > 80) {
      return { error: 'Название компании должно быть строкой не длиннее 80 символов' };
    } else {
      result.displayName = displayName.trim();
    }
  }
  if (logoUrl !== undefined) {
    if (logoUrl === null || logoUrl === '') {
      result.logoUrl = null;
    } else if (typeof logoUrl !== 'string' || !/^https:\/\/.+/.test(logoUrl.trim())) {
      return { error: 'Ссылка на логотип должна начинаться с https://' };
    } else {
      result.logoUrl = logoUrl.trim();
    }
  }
  if (accentColor !== undefined) {
    if (accentColor === null || accentColor === '') {
      result.accentColor = null;
    } else if (typeof accentColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accentColor.trim())) {
      return { error: 'Цвет должен быть в формате #RRGGBB' };
    } else {
      result.accentColor = accentColor.trim();
    }
  }
  return { value: result };
}

module.exports = { validateFieldOverrides, validateCustomDocTypes, validateBusinessRules, validateBranding };
