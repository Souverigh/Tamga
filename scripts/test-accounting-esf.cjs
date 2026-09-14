const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEsfDoc } = require('../lib/accounting/document');
const { ESF_RULES } = require('../lib/accounting/rules/esf');
const { runRules, overallStatus } = require('../lib/accounting/rules/engine');
const { render } = require('../lib/accounting/i18n');

function field(value, confidence = 95, page = 1) {
  return { value: String(value), raw_text: String(value), page, confidence };
}

function baseHeader(overrides = {}) {
  return {
    invoice_number: field('154'),
    invoice_date: field('2026-08-31'),
    seller_name: field('ОсОО «Ала-Тоо Сервис»'),
    seller_inn: field('12345678901234'),
    buyer_name: field('ОсОО «Теңир Трейд»'),
    buyer_inn: field('98765432109876'),
    subtotal: field('100000'),
    vat_rate: field('0.12'),
    vat_total: field('12000'),
    total: field('112000'),
    currency: field('KGS'),
    ...overrides
  };
}

function baseItems() {
  return [{
    description: field('Товар А'),
    quantity: field('10'),
    unit: field('шт'),
    unit_price: field('10000'),
    amount: field('100000'),
    vat_rate: field('0.12'),
    vat_amount: field('12000')
  }];
}

function run(header, items) {
  const doc = buildEsfDoc({ header, items });
  return runRules(ESF_RULES, doc);
}

// §22 "Valid invoice" → PASS
test('valid invoice: base 100000, VAT 12% = 12000, total 112000 → PASS', () => {
  const results = run(baseHeader(), baseItems());
  assert.equal(overallStatus(results), 'PASS');
  assert.ok(!results.some(r => r.status === 'FAILED'));
});

// §22 "Invalid VAT" → ERROR, expected 12000, difference 3000
test('invalid VAT: document shows 15000 instead of 12000 → FAILED with expected/difference', () => {
  const results = run(baseHeader({ vat_total: field('15000'), total: field('115000') }), baseItems());
  const vatResult = results.find(r => r.rule_id === 'INV-004');
  assert.equal(vatResult.status, 'FAILED');
  assert.equal(vatResult.params.expected, 12000);
  assert.equal(vatResult.params.actual, 15000);
  assert.equal(vatResult.params.difference, 3000);
  assert.equal(overallStatus(results), 'FAILED');

  const message = render(vatResult.message_key, vatResult.params);
  assert.equal(message, 'Возможная ошибка НДС. При базе 100000 сом и ставке 12% ожидаемая сумма НДС — 12000 сом. В документе указано 15000 сом.');
});

// §16 "Line error": quantity=10, price=500, line amount=5500 (expected 5000)
test('line amount mismatch: 10 × 500 should be 5000, document shows 5500 → FAILED', () => {
  const items = [{
    description: field('Товар Б'), quantity: field('10'), unit: field('шт'),
    unit_price: field('500'), amount: field('5500'), vat_rate: field(''), vat_amount: field('')
  }];
  // subtotal/vat/total intentionally left consistent with header 100000 so only INV-002 is under test
  const results = run(baseHeader(), items);
  const lineResult = results.find(r => r.rule_id === 'INV-002');
  assert.equal(lineResult.status, 'FAILED');
  assert.equal(lineResult.params.expected, 5000);
  assert.equal(lineResult.params.actual, 5500);
});

// §16 "OCR challenge": mathematically fine but a required field unreadable → review, not a false accounting error
test('missing required field → INSUFFICIENT_DATA/FAILED, never a silent PASS', () => {
  const results = run(baseHeader({ buyer_inn: field('') }), baseItems());
  const req = results.find(r => r.rule_id === 'INV-001' && r.params.field === 'buyer_inn');
  assert.equal(req.status, 'FAILED');
  assert.notEqual(overallStatus(results), 'PASS');
});

// §12: low extraction confidence must not be presented as certain
test('low-confidence field produces a WARNING, not a silent PASS', () => {
  const results = run(baseHeader({ seller_inn: field('12345678901234', 40) }), baseItems());
  const conf = results.find(r => r.rule_id === 'INV-CONF' && r.params.field === 'seller_inn');
  assert.equal(conf.status, 'WARNING');
});

// §11: missing data must not produce a false PASS
test('missing subtotal → INSUFFICIENT_DATA for VAT/sum rules, not PASS', () => {
  const results = run(baseHeader({ subtotal: field('') }), baseItems());
  const vat = results.find(r => r.rule_id === 'INV-004');
  const sum = results.find(r => r.rule_id === 'INV-003');
  assert.equal(vat.status, 'INSUFFICIENT_DATA');
  assert.equal(sum.status, 'INSUFFICIENT_DATA');
  assert.equal(overallStatus(results), 'INSUFFICIENT_DATA');
});

// INN format sanity check (WARNING, not ERROR — no confirmed checksum algorithm)
test('malformed INN triggers a WARNING', () => {
  const results = run(baseHeader({ seller_inn: field('12345') }), baseItems());
  const inn = results.find(r => r.rule_id === 'INV-INN');
  assert.equal(inn.status, 'WARNING');
});

test('i18n render falls back to the key itself when no translation exists', () => {
  assert.equal(render('accounting.invoice.nonexistent_key', {}), 'accounting.invoice.nonexistent_key');
});
