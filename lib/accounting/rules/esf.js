// Правила для Счет-фактура / ЭСФ — §7 хендовера. Первый вертикальный срез
// (§21 Phase 3) — только эти шесть + одна проверка ИНН.
//
// Допуск на арифметику: 1% от базы (тот же порядок, что в существующем
// lib/postprocess/businessRules.js DEFAULT_TOLERANCE_PERCENT, но это
// СОВПАДЕНИЕ значения, не общий код — файлы независимы).
const TOLERANCE_PERCENT = 1;

function withinTolerance(actual, expected) {
  const toleranceAmount = Math.abs(expected) * TOLERANCE_PERCENT / 100;
  return Math.abs(actual - expected) <= toleranceAmount;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const REQUIRED_HEADER_FIELDS = ['invoice_number', 'invoice_date', 'seller_inn', 'buyer_inn'];

// INV-001 — required key fields missing.
const INV_001 = {
  id: 'INV-001',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'ERROR',
  check(doc) {
    return REQUIRED_HEADER_FIELDS.map(field => {
      const value = doc.normalized.header[field];
      const isMissing = value === null || value === '' || value === undefined;
      if (!isMissing) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'FAILED', message_key: 'accounting.invoice.required_field_missing', params: { field } };
    });
  }
};

// Формат ИНН КР: 14 цифр (юрлицо) или 14 цифр (ИНН физлица тоже 14 в КР) —
// проверяем только "похоже на число нужной длины", не валидируем контрольную
// сумму (алгоритм не подтверждён источником — не выдумываем регулятивное
// правило без §3-источника).
const INN_FIELDS = ['seller_inn', 'buyer_inn'];
const INN_PATTERN = /^\d{14}$/;

const INV_INN_FORMAT = {
  id: 'INV-INN',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'WARNING',
  check(doc) {
    return INN_FIELDS.map(field => {
      const value = doc.normalized.header[field];
      if (value === null || value === '') return { status: 'NOT_APPLICABLE', message_key: null, params: {} };
      if (INN_PATTERN.test(String(value).trim())) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'WARNING', message_key: 'accounting.invoice.inn_format_invalid', params: { field, value } };
    });
  }
};

// INV-002 — quantity × unit_price ≈ line_amount, per line item.
const INV_002 = {
  id: 'INV-002',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    return doc.normalized.items.map((item, index) => {
      const { quantity, unit_price: unitPrice, amount } = item;
      if (quantity == null || unitPrice == null || amount == null) {
        return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.invoice.insufficient_data', params: { rule: 'INV-002', line: index + 1 } };
      }
      const expected = round2(quantity * unitPrice);
      if (withinTolerance(amount, expected)) return { status: 'PASS', message_key: null, params: {} };
      return {
        status: 'FAILED',
        message_key: 'accounting.invoice.line_amount_mismatch',
        params: {
          description: doc.items[index]?.description?.value || `строка ${index + 1}`,
          quantity, unit_price: unitPrice, expected, actual: amount,
          difference: round2(amount - expected)
        }
      };
    });
  }
};

// INV-003 — sum(line amounts) ≈ subtotal.
const INV_003 = {
  id: 'INV-003',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    const amounts = doc.normalized.items.map(i => i.amount);
    const subtotal = doc.normalized.header.subtotal;
    if (subtotal == null || amounts.some(a => a == null) || amounts.length === 0) {
      return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.invoice.insufficient_data', params: { rule: 'INV-003' } };
    }
    const sum = round2(amounts.reduce((a, b) => a + b, 0));
    if (withinTolerance(sum, subtotal)) return { status: 'PASS', message_key: null, params: {} };
    return {
      status: 'FAILED',
      message_key: 'accounting.invoice.lines_sum_mismatch',
      params: { sum, subtotal, difference: round2(sum - subtotal) }
    };
  }
};

// INV-004 — taxable_base × vat_rate ≈ vat_amount (document level).
// Пример из хендовера §0/§7: база 100000, ставка 12% → ожидаемый НДС 12000.
const INV_004 = {
  id: 'INV-004',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    const { subtotal, vat_rate: vatRate, vat_total: vatTotal } = doc.normalized.header;
    if (subtotal == null || vatRate == null || vatTotal == null) {
      return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.invoice.insufficient_data', params: { rule: 'INV-004' } };
    }
    const expected = round2(subtotal * vatRate);
    if (withinTolerance(vatTotal, expected)) return { status: 'PASS', message_key: null, params: {} };
    return {
      status: 'FAILED',
      message_key: 'accounting.invoice.vat_mismatch',
      params: { base: subtotal, rate: round2(vatRate * 100), expected, actual: vatTotal, difference: round2(vatTotal - expected) }
    };
  }
};

// INV-005 — subtotal + vat_total ≈ total.
const INV_005 = {
  id: 'INV-005',
  category: 'MATHEMATICAL',
  severity: 'ERROR',
  check(doc) {
    const { subtotal, vat_total: vatTotal, total } = doc.normalized.header;
    if (subtotal == null || vatTotal == null || total == null) {
      return { status: 'INSUFFICIENT_DATA', message_key: 'accounting.invoice.insufficient_data', params: { rule: 'INV-005' } };
    }
    const expected = round2(subtotal + vatTotal);
    if (withinTolerance(total, expected)) return { status: 'PASS', message_key: null, params: {} };
    return {
      status: 'FAILED',
      message_key: 'accounting.invoice.total_mismatch',
      params: { expected, actual: total, difference: round2(total - expected) }
    };
  }
};

// INV-006 — sum(line VAT) ≈ vat_total.
const INV_006 = {
  id: 'INV-006',
  category: 'MATHEMATICAL',
  severity: 'WARNING', // WARNING, не ERROR — не все ЭСФ показывают НДС построчно (см. lib/docSchema.js totals-комментарий)
  check(doc) {
    const lineVats = doc.normalized.items.map(i => i.vat_amount);
    const vatTotal = doc.normalized.header.vat_total;
    if (vatTotal == null || lineVats.length === 0 || lineVats.some(v => v == null)) {
      return { status: 'NOT_APPLICABLE', message_key: null, params: {} }; // построчный НДС не всегда есть — не INSUFFICIENT_DATA
    }
    const sum = round2(lineVats.reduce((a, b) => a + b, 0));
    if (withinTolerance(sum, vatTotal)) return { status: 'PASS', message_key: null, params: {} };
    return {
      status: 'WARNING',
      message_key: 'accounting.invoice.line_vat_sum_mismatch',
      params: { sum, total: vatTotal, difference: round2(sum - vatTotal) }
    };
  }
};

// Не пронумерованное правило хендовера, но явно требуется §12: низкая
// уверенность по любому header-полю → WARNING, не молчаливый PASS.
const LOW_CONFIDENCE_THRESHOLD = 70;
const INV_CONFIDENCE = {
  id: 'INV-CONF',
  category: 'DOCUMENT_CONSISTENCY',
  severity: 'WARNING',
  check(doc) {
    return Object.entries(doc.header).map(([field, raw]) => {
      if (!raw || raw.value === '' || raw.value == null) return { status: 'NOT_APPLICABLE', message_key: null, params: {} };
      if (raw.confidence >= LOW_CONFIDENCE_THRESHOLD) return { status: 'PASS', message_key: null, params: {} };
      return { status: 'WARNING', message_key: 'accounting.invoice.low_confidence', params: { field, confidence: raw.confidence } };
    });
  }
};

const ESF_RULES = [INV_001, INV_INN_FORMAT, INV_002, INV_003, INV_004, INV_005, INV_006, INV_CONFIDENCE];

module.exports = { ESF_RULES };
