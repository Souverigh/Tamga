// Правила для Платёжное поручение — §21 Phase 4, добавлено 15 сен 2026 как
// третий и последний из Phase-4-типов. Структурно проще ЭСФ/накладной/акта:
// нет таблицы строк, поэтому нет математических PP-002/003/004-эквивалентов
// (нечего сверять — только одна итоговая сумма, а не qty×price построчно и
// subtotal+VAT=total). Только обязательные поля, формат ИНН и уверенность.

const REQUIRED_HEADER_FIELDS = ['payment_order_number', 'payment_order_date', 'buyer_inn', 'recipient_inn', 'total'];

// PP-001 — required key fields missing.
const PP_001 = {
  id: 'PP-001',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'ERROR',
  check(doc) {
    return REQUIRED_HEADER_FIELDS.map(field => {
      const value = doc.normalized.header[field];
      const isMissing = value === null || value === '' || value === undefined;
      if (!isMissing) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'FAILED', message_key: 'accounting.payment_order.required_field_missing', params: { field } };
    });
  }
};

// PP-INN — формат ИНН КР (14 цифр), та же логика/тот же дисклеймер про
// отсутствие проверки контрольной суммы, что INV-INN/NAK-INN/ACT-INN.
const INN_FIELDS = ['buyer_inn', 'recipient_inn'];
const INN_PATTERN = /^\d{14}$/;

const PP_INN_FORMAT = {
  id: 'PP-INN',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'WARNING',
  check(doc) {
    return INN_FIELDS.map(field => {
      const value = doc.normalized.header[field];
      if (value === null || value === '') return { status: 'NOT_APPLICABLE', message_key: null, params: {} };
      if (INN_PATTERN.test(String(value).trim())) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'WARNING', message_key: 'accounting.payment_order.inn_format_invalid', params: { field, value } };
    });
  }
};

// Низкая уверенность по любому header-полю → WARNING (§12), тот же приём,
// что INV-CONF/NAK-CONF/ACT-CONF.
const LOW_CONFIDENCE_THRESHOLD = 70;
const PP_CONFIDENCE = {
  id: 'PP-CONF',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'WARNING',
  check(doc) {
    return Object.entries(doc.header).map(([field, raw]) => {
      if (!raw || raw.value === '' || raw.value == null) return { status: 'NOT_APPLICABLE', message_key: null, params: {} };
      if (raw.confidence >= LOW_CONFIDENCE_THRESHOLD) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'WARNING', message_key: 'accounting.payment_order.low_confidence', params: { field, confidence: raw.confidence } };
    });
  }
};

const PAYMENT_ORDER_RULES = [PP_001, PP_INN_FORMAT, PP_CONFIDENCE];

module.exports = { PAYMENT_ORDER_RULES };
