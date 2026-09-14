// Схема типов бухгалтерских документов — ОТДЕЛЬНАЯ от lib/docSchema.js.
//
// ВАЖНО (Ethan, 14 сен 2026, "оригинальный код на гитхабе не меняй"): этот
// модуль и всё в lib/accounting/** — новая, параллельная ветка функциональности.
// lib/docSchema.js и существующий тип "Счёт-фактура / Инвойс" НЕ трогаем и
// НЕ переиспользуем — это разные продуктовые сценарии (общее распознавание
// документов для клиентов Tamga vs. бухгалтерская валидация с детерминированными
// проверками). Пересечения по названиям/ключам избегаем намеренно.
//
// Первый вертикальный срез (ADRE_Accounting_Handover.md §21 Phase 3): только
// 'esf'. Остальные типы из §4/§21 Phase 4 добавляются как записи в
// ACCOUNTING_DOC_TYPES по мере реализации — форма ниже уже рассчитана на это.
// 'nakladnaya' (Товарная накладная) добавлен 14 сен 2026 как первый Phase-4-тип.

const ACCOUNTING_DOC_TYPES = {
  esf: {
    label: 'Счет-фактура / ЭСФ',
    labelKy: null, // TODO при добавлении KY
    labelEn: 'Invoice / e-invoice',
    hint: 'a VAT invoice (Счет-фактура, электронная счет-фактура/ЭСФ) issued for payment, with seller/buyer INN, ' +
      'a table of line items, and document-level subtotal/VAT/total — Resolution №141',
    regulatorySource: { name: 'Постановление КМ КР №141', version: null, effectiveFrom: null, effectiveTo: null, lastVerifiedAt: null }
  },
  // Второй тип (Phase 4, §8 хендовера) — выбран Ethan, 14 сен 2026, как первый
  // из четырёх Phase-4-типов. Схема полей и правила см. extraction.js/rules/nakladnaya.js.
  nakladnaya: {
    label: 'Товарная накладная',
    labelKy: null, // TODO при добавлении KY
    labelEn: 'Delivery note / goods invoice',
    hint: 'a goods delivery note (Товарная накладная, Накладная, ТТН), for a SPECIFIC transaction between a named ' +
      'supplier and buyer, with a table of line items (goods, quantity, price) and document-level subtotal/VAT/total — ' +
      'Resolution №220',
    regulatorySource: { name: 'Постановление КМ КР №220', version: null, effectiveFrom: null, effectiveTo: null, lastVerifiedAt: null }
  }
};

function isKnownDocType(docType) {
  return Object.prototype.hasOwnProperty.call(ACCOUNTING_DOC_TYPES, docType);
}

function allDocTypeKeys() {
  return Object.keys(ACCOUNTING_DOC_TYPES);
}

function hintsForClassification() {
  return Object.fromEntries(
    Object.entries(ACCOUNTING_DOC_TYPES).map(([key, def]) => [key, def.hint])
  );
}

module.exports = { ACCOUNTING_DOC_TYPES, isKnownDocType, allDocTypeKeys, hintsForClassification };
