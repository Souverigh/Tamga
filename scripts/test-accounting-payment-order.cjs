const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPaymentOrderDoc } = require('../lib/accounting/document');
const { PAYMENT_ORDER_RULES } = require('../lib/accounting/rules/payment_order');
const { runRules, overallStatus } = require('../lib/accounting/rules/engine');
const { render } = require('../lib/accounting/i18n');

function field(value, confidence = 95, page = 1) {
  return { value: String(value), raw_text: String(value), page, confidence };
}

function baseHeader(overrides = {}) {
  return {
    payment_order_number: field('427'),
    payment_order_date: field('2026-08-31'),
    buyer_name: field('ОсОО «Теңир Трейд»'),
    buyer_inn: field('98765432109876'),
    buyer_account: field('1234567890123456'),
    recipient_name: field('ОсОО «Ала-Тоо Сервис»'),
    recipient_inn: field('12345678901234'),
    recipient_account: field('6543210987654321'),
    total: field('112000'),
    currency: field('KGS'),
    payment_purpose: field('Оплата по счёту №58 от 31.08.2026 за товар, в т.ч. НДС 12000'),
    ...overrides
  };
}

function run(header) {
  const doc = buildPaymentOrderDoc({ header, items: [] });
  return runRules(PAYMENT_ORDER_RULES, doc);
}

// all required fields present, valid INN format → PASS
test('valid payment order → PASS', () => {
  const results = run(baseHeader());
  assert.equal(overallStatus(results), 'PASS');
  assert.ok(!results.some(r => r.status === 'FAILED'));
});

// no line-items table — buildPaymentOrderDoc should not choke on an empty
// items array and no rule should reference items
test('items array stays empty and unused', () => {
  const doc = buildPaymentOrderDoc({ header: baseHeader(), items: [] });
  assert.deepEqual(doc.items, []);
  assert.deepEqual(doc.normalized.items, []);
});

// missing required field must not produce a silent PASS
test('missing total → FAILED, never a silent PASS', () => {
  const results = run(baseHeader({ total: field('') }));
  const req = results.find(r => r.rule_id === 'PP-001' && r.params.field === 'total');
  assert.equal(req.status, 'FAILED');
  assert.notEqual(overallStatus(results), 'PASS');
});

test('missing recipient_inn → FAILED', () => {
  const results = run(baseHeader({ recipient_inn: field('') }));
  const req = results.find(r => r.rule_id === 'PP-001' && r.params.field === 'recipient_inn');
  assert.equal(req.status, 'FAILED');
});

// low extraction confidence must not be presented as certain
test('low-confidence field produces a WARNING, not a silent PASS', () => {
  const results = run(baseHeader({ recipient_inn: field('12345678901234', 40) }));
  const conf = results.find(r => r.rule_id === 'PP-CONF' && r.params.field === 'recipient_inn');
  assert.equal(conf.status, 'WARNING');
});

// INN format sanity check (WARNING, not ERROR — same convention as other types)
test('malformed INN triggers a WARNING', () => {
  const results = run(baseHeader({ buyer_inn: field('12345') }));
  const inn = results.find(r => r.rule_id === 'PP-INN');
  assert.equal(inn.status, 'WARNING');
});

test('i18n render falls back to the key itself when no translation exists', () => {
  assert.equal(render('accounting.payment_order.nonexistent_key', {}), 'accounting.payment_order.nonexistent_key');
});
