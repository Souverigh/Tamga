// Правила для Товарная накладная — §8 хендовера (добавлено 14 сен 2026 как
// первый Phase-4-тип, §21). Только три математических правила, которые прямо
// перечислены в §8 (в отличие от ЭСФ §7 здесь нет отдельной проверки
// "ставка НДС × база = сумма НДС" — накладная в хендовере не описывает
// построчную/документную ставку НДС, только subtotal+VAT=total).
//
// Допуск на арифметику и round2 — тот же приём, что в rules/esf.js
// (СОВПАДЕНИЕ значения TOLERANCE_PERCENT, не общий импорт — файлы
// намеренно независимы, см. комментарий в esf.js).
const TOLERANCE_PERCENT = 1;

function withinTolerance(actual, expected) {
  const toleranceAmount = Math.abs(expected) * TOLERANCE_PERCENT / 100;
  return Math.abs(actual - expected) <= toleranceAmount;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const REQUIRED_HEADER_FIELDS = ['delivery_note_number', 'delivery_note_date', 'supplier_inn', 'buyer_inn'];

// NAK-001 — required key fields missing.
const NAK_001 = {
  id: 'NAK-001',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'ERROR',
  check(doc) {
    return REQUIRED_HEADER_FIELDS.map(field => {
      const value = doc.normalized.header[field];
      const isMissing = value === null || value === '' || value === undefined;
      if (!isMissing) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'FAILED', message_key: 'accounting.delivery_note.required_field_missing', params: { field } };
    });
  }
};

// NAK-INN — формат ИНН КР (14 цифр), та же логика/тот же дисклеймер про
// отсутствие проверки контрольной суммы, что INV-INN в rules/esf.js.
const INN_FIELDS = ['supplier_inn', 'buyer_inn'];
const INN_PATTERN = /^\d{14}$/;

const NAK_INN_FORMAT = {
  id: 'NAK-INN',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'WARNING',
  check(doc) {
    return INN_FIELDS.map(field => {
      const value = doc.normalized.header[field];
      if (value === null || value === '') return { status: 'NOT_APPLICABLE', message_key: null, params: {} };
      if (INN_PATTERN.test(String(value).trim())) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'WARNING', message_key: 'accounting.delivery_note.inn_format_invalid', params: { field, value } };
    });
  }
};

// NAK-002 — quantity × unit_price ≈ line_amount, per line item.
const NAK_002 = {
  id: 'NAK-002',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    return doc.normalized.items.map((item, index) => {
      const { quantity, unit_price: unitPrice, amount } = item;
      if (quantity == null || unitPrice == null || amount == null) {
        return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.delivery_note.insufficient_data', params: { rule: 'NAK-002', line: index + 1 } };
      }
      const expected = round2(quantity * unitPrice);
      if (withinTolerance(amount, expected)) return { status: 'PASS', message_key: null, params: {} };
      return {
        status: 'FAILED',
        message_key: 'accounting.delivery_note.line_amount_mismatch',
        params: {
          description: doc.items[index]?.description?.value || `строка ${index + 1}`,
          quantity, unit_price: unitPrice, expected, actual: amount,
          difference: round2(amount - expected)
        }
      };
    });
  }
};

// NAK-003 — sum(line amounts) ≈ subtotal.
const NAK_003 = {
  id: 'NAK-003',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    const amounts = doc.normalized.items.map(i => i.amount);
    const subtotal = doc.normalized.header.subtotal;
    if (subtotal == null || amounts.some(a => a == null) || amounts.length === 0) {
      return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.delivery_note.insufficient_data', params: { rule: 'NAK-003' } };
    }
    const sum = round2(amounts.reduce((a, b) => a + b, 0));
    if (withinTolerance(sum, subtotal)) return { status: 'PASS', message_key: null, params: {} };
    return {
      status: 'FAILED',
      message_key: 'accounting.delivery_note.lines_sum_mismatch',
      params: { sum, subtotal, difference: round2(sum - subtotal) }
    };
  }
};

// NAK-004 — subtotal + vat_total ≈ total. (§8: "subtotal + VAT = total" —
// в отличие от ЭСФ §7 здесь нет отдельного правила "база × ставка = НДС",
// т.к. хендовер не описывает для накладной поле ставки НДС.)
const NAK_004 = {
  id: 'NAK-004',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    const { subtotal, vat_total: vatTotal, total } = doc.normalized.header;
    if (subtotal == null || vatTotal == null || total == null) {
      return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.delivery_note.insufficient_data', params: { rule: 'NAK-004' } };
    }
    const expected = round2(subtotal + vatTotal);
    if (withinTolerance(total, expected)) return { status: 'PASS', message_key: null, params: {} };
    return {
      status: 'FAILED',
      message_key: 'accounting.delivery_note.total_mismatch',
      params: { expected, actual: total, difference: round2(total - expected) }
    };
  }
};

// Низкая уверенность по любому header-полю → WARNING (§12), тот же приём,
// что INV-CONF в rules/esf.js.
const LOW_CONFIDENCE_THRESHOLD = 70;
const NAK_CONFIDENCE = {
  id: 'NAK-CONF',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'WARNING',
  check(doc) {
    return Object.entries(doc.header).map(([field, raw]) => {
      if (!raw || raw.value === '' || raw.value == null) return { status: 'NOT_APPLICABLE', message_key: null, params: {} };
      if (raw.confidence >= LOW_CONFIDENCE_THRESHOLD) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'WARNING', message_key: 'accounting.delivery_note.low_confidence', params: { field, confidence: raw.confidence } };
    });
  }
};

const NAKLADNAYA_RULES = [NAK_001, NAK_INN_FORMAT, NAK_002, NAK_003, NAK_004, NAK_CONFIDENCE];

module.exports = { NAKLADNAYA_RULES };
