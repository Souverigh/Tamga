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
  },
  // Третий тип (Phase 4, 15 сен 2026) — выбран Ethan как второй из трёх
  // оставшихся Phase-4-типов (после накладной). Схема полей и правила см.
  // extraction.js/rules/act.js. regulatorySource.name намеренно null —
  // конкретный номер постановления КМ КР для акта не подтверждён (в отличие
  // от ЭСФ/накладной, где номер уже был в хендовере); заполнить при
  // подтверждении, поле нигде в коде программно не используется, только
  // метаданные для будущего UI/справки.
  act: {
    label: 'Акт выполненных работ',
    labelKy: null, // TODO при добавлении KY
    labelEn: 'Act of completed works / services',
    hint: 'an act of completed works or services (Акт выполненных работ / оказанных услуг), for a SPECIFIC ' +
      'transaction between a named contractor (исполнитель) and customer (заказчик), with a table of line items ' +
      '(work/service description, quantity, price) and document-level subtotal/VAT/total — NOT a delivery note ' +
      'for physical goods and NOT an invoice requesting payment',
    regulatorySource: { name: null, version: null, effectiveFrom: null, effectiveTo: null, lastVerifiedAt: null }
  },
  // Четвёртый тип (Phase 4, 15 сен 2026) — выбран Ethan как третий из трёх
  // оставшихся Phase-4-типов (после накладной и акта). Структурно ДРУГОЙ:
  // банковский документ, не первичный документ поставки/услуги — нет таблицы
  // строк, нет subtotal/vat_total (просто одна сумма платежа) — см.
  // extraction.js/rules/payment_order.js. total/currency/buyer_name/buyer_inn
  // переиспользованы как обычно (buyer = плательщик, платит); получатель
  // платежа — отдельные recipient_name/recipient_inn (не seller/supplier/
  // contractor, т.к. смысл поля здесь именно "кому платят по платёжке", а не
  // "кто поставил товар/услугу", хотя роль концептуально та же — получающая
  // деньги сторона).
  payment_order: {
    label: 'Платёжное поручение',
    labelKy: null, // TODO при добавлении KY
    labelEn: 'Payment order',
    hint: 'a bank payment order (Платёжное поручение) — a banking document instructing a bank to transfer a SPECIFIC ' +
      'amount from a payer to a recipient, with payer/recipient names, INN and bank account details, a payment ' +
      'purpose (назначение платежа), and a single payment amount — NOT a document with a line-items table and NOT ' +
      'itself proof that goods/services were delivered',
    regulatorySource: { name: null, version: null, effectiveFrom: null, effectiveTo: null, lastVerifiedAt: null }
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
