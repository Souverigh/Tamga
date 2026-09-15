// Правила для Акт выполненных работ — §21 Phase 4, добавлено 15 сен 2026 как
// второй из трёх оставшихся Phase-4-типов (после накладной). Та же
// математическая структура, что у накладной (qty×price=строка,
// сумма строк=subtotal, subtotal+VAT=total) — у акта тоже нет отдельной
// построчной ставки НДС, поэтому нет ACT-эквивалента INV-004.
//
// Допуск на арифметику и round2 — то же значение TOLERANCE_PERCENT, что в
// rules/esf.js и rules/nakladnaya.js (совпадение, не общий импорт — файлы
// намеренно независимы).
const TOLERANCE_PERCENT = 1;

function withinTolerance(actual, expected) {
  const toleranceAmount = Math.abs(expected) * TOLERANCE_PERCENT / 100;
  return Math.abs(actual - expected) <= toleranceAmount;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const REQUIRED_HEADER_FIELDS = ['act_number', 'act_date', 'contractor_inn', 'buyer_inn'];

// ACT-001 — required key fields missing.
const ACT_001 = {
  id: 'ACT-001',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'ERROR',
  check(doc) {
    return REQUIRED_HEADER_FIELDS.map(field => {
      const value = doc.normalized.header[field];
      const isMissing = value === null || value === '' || value === undefined;
      if (!isMissing) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'FAILED', message_key: 'accounting.act.required_field_missing', params: { field } };
    });
  }
};

// ACT-INN — формат ИНН КР (14 цифр), та же логика/тот же дисклеймер про
// отсутствие проверки контрольной суммы, что INV-INN/NAK-INN.
const INN_FIELDS = ['contractor_inn', 'buyer_inn'];
const INN_PATTERN = /^\d{14}$/;

const ACT_INN_FORMAT = {
  id: 'ACT-INN',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'WARNING',
  check(doc) {
    return INN_FIELDS.map(field => {
      const value = doc.normalized.header[field];
      if (value === null || value === '') return { status: 'NOT_APPLICABLE', message_key: null, params: {} };
      if (INN_PATTERN.test(String(value).trim())) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'WARNING', message_key: 'accounting.act.inn_format_invalid', params: { field, value } };
    });
  }
};

// ACT-002 — quantity × unit_price ≈ line_amount, per line item. Quantity is
// often "1" for a service line, but the check is the same arithmetic.
const ACT_002 = {
  id: 'ACT-002',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    return doc.normalized.items.map((item, index) => {
      const { quantity, unit_price: unitPrice, amount } = item;
      if (quantity == null || unitPrice == null || amount == null) {
        return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.act.insufficient_data', params: { rule: 'ACT-002', line: index + 1 } };
      }
      const expected = round2(quantity * unitPrice);
      if (withinTolerance(amount, expected)) return { status: 'PASS', message_key: null, params: {} };
      return {
        status: 'FAILED',
        message_key: 'accounting.act.line_amount_mismatch',
        params: {
          description: doc.items[index]?.description?.value || `строка ${index + 1}`,
          quantity, unit_price: unitPrice, expected, actual: amount,
          difference: round2(amount - expected)
        }
      };
    });
  }
};

// ACT-003 — sum(line amounts) ≈ subtotal.
const ACT_003 = {
  id: 'ACT-003',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    const amounts = doc.normalized.items.map(i => i.amount);
    const subtotal = doc.normalized.header.subtotal;
    if (subtotal == null || amounts.some(a => a == null) || amounts.length === 0) {
      return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.act.insufficient_data', params: { rule: 'ACT-003' } };
    }
    const sum = round2(amounts.reduce((a, b) => a + b, 0));
    if (withinTolerance(sum, subtotal)) return { status: 'PASS', message_key: null, params: {} };
    return {
      status: 'FAILED',
      message_key: 'accounting.act.lines_sum_mismatch',
      params: { sum, subtotal, difference: round2(sum - subtotal) }
    };
  }
};

// ACT-004 — subtotal + vat_total ≈ total. Same reasoning as NAK-004: no
// separate base×rate=VAT rule, since the act has no per-line VAT rate field.
const ACT_004 = {
  id: 'ACT-004',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    const { subtotal, vat_total: vatTotal, total } = doc.normalized.header;
    if (subtotal == null || vatTotal == null || total == null) {
      return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.act.insufficient_data', params: { rule: 'ACT-004' } };
    }
    const expected = round2(subtotal + vatTotal);
    if (withinTolerance(total, expected)) return { status: 'PASS', message_key: null, params: {} };
    return {
      status: 'FAILED',
      message_key: 'accounting.act.total_mismatch',
      params: { expected, actual: total, difference: round2(total - expected) }
    };
  }
};

// Низкая уверенность по любому header-полю → WARNING (§12), тот же приём,
// что INV-CONF/NAK-CONF.
const LOW_CONFIDENCE_THRESHOLD = 70;
const ACT_CONFIDENCE = {
  id: 'ACT-CONF',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'WARNING',
  check(doc) {
    return Object.entries(doc.header).map(([field, raw]) => {
      if (!raw || raw.value === '' || raw.value == null) return { status: 'NOT_APPLICABLE', message_key: null, params: {} };
      if (raw.confidence >= LOW_CONFIDENCE_THRESHOLD) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'WARNING', message_key: 'accounting.act.low_confidence', params: { field, confidence: raw.confidence } };
    });
  }
};

const ACT_RULES = [ACT_001, ACT_INN_FORMAT, ACT_002, ACT_003, ACT_004, ACT_CONFIDENCE];

module.exports = { ACT_RULES };
