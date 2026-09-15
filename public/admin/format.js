// public/admin/format.js — чистые функции форматирования для админки
// (никакого DOM/state, только преобразование данных в текст/массивы).
// Вынесено из admin.js 15 сен 2026 (модуляризация по просьбе Ethan).

export function formatUpdatedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function badgesFor(client) {
  const badges = [];
  if (client.has_password) badges.push('🔒 Пароль на сайт');
  if (client.page_limit != null) {
    const exhausted = client.pages_used >= client.page_limit;
    badges.push(`${exhausted ? '⛔' : '📄'} Страниц: ${client.pages_used}/${client.page_limit}`);
  }
  if (client.fields && client.fields.length) badges.push('Устар. поля (любой тип)');
  if (client.field_overrides && Object.keys(client.field_overrides).length) badges.push(`Переопределений: ${Object.keys(client.field_overrides).length}`);
  if (client.custom_doc_types && Object.keys(client.custom_doc_types).length) badges.push(`Своих типов: ${Object.keys(client.custom_doc_types).length}`);
  if (client.formatting && (client.formatting.dateFormat || client.formatting.decimalSeparator)) badges.push('Формат');
  if (client.formatting && client.formatting.maxConcurrency) badges.push(`Приоритет ×${client.formatting.maxConcurrency}`);
  if (client.formatting && client.formatting.webhookUrl) badges.push('Вебхук');
  if (client.formatting && Array.isArray(client.formatting.businessRules) && client.formatting.businessRules.length) badges.push(`Правил: ${client.formatting.businessRules.length}`);
  if (client.display_name || client.logo_url || client.accent_color) badges.push('Фасад');
  return badges;
}

export function splitFields(text) {
  return text.split(',').map(s => s.trim()).filter(Boolean);
}

// Ethan, 7 сен 2026 ("чтобы сами компании делали их под свои нужды", пример:
// "НДС ≈ 12% от суммы"), расширено 8 сен 2026 с одного типа до пяти. См.
// public/js/postprocess/businessRules.js — тот же формат объекта правила,
// что рендерится/сохраняется здесь.
export function ruleSummaryText(rule) {
  const levelLabel = rule.level === 'info' ? 'информация' : 'ошибка';
  switch (rule.type) {
    case 'percentage_match':
      return `«${rule.valueField}» ≈ ${rule.expectedPercent}% от «${rule.baseField}» (допуск ±${rule.tolerancePercent ?? 1}, уровень: ${levelLabel})`;
    case 'sum_match':
      return `Сумма «${rule.sumFields.join('», «')}» ≈ «${rule.targetField}» (допуск ±${rule.tolerancePercent ?? 1}, уровень: ${levelLabel})`;
    case 'date_order':
      return `«${rule.earlierField}» не позже «${rule.laterField}» (уровень: ${levelLabel})`;
    case 'required_field':
      return `«${rule.field}» обязательно для заполнения (уровень: ${levelLabel})`;
    case 'range_check': {
      const bounds = [rule.min != null ? `от ${rule.min}` : null, rule.max != null ? `до ${rule.max}` : null].filter(Boolean).join(' ');
      return `«${rule.field}» ${bounds} (уровень: ${levelLabel})`;
    }
    default:
      return rule.type;
  }
}
