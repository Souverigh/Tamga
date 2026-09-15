const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildActDoc } = require('../lib/accounting/document');
const { ACT_RULES } = require('../lib/accounting/rules/act');
const { runRules, overallStatus } = require('../lib/accounting/rules/engine');
const { render } = require('../lib/accounting/i18n');

function field(value, confidence = 95, page = 1) {
  return { value: String(value), raw_text: String(value), page, confidence };
}

function baseHeader(overrides = {}) {
  return {
    act_number: field('14'),
    act_date: field('2026-08-31'),
    contractor_name: field('ОсОО «Ала-Тоо Сервис»'),
    contractor_inn: field('12345678901234'),
    buyer_name: field('ОсОО «Теңир Трейд»'),
    buyer_inn: field('98765432109876'),
    subtotal: field('100000'),
    vat_total: field('12000'),
    total: field('112000'),
    currency: field('KGS'),
    ...overrides
  };
}

function baseItems() {
  return [{
    description: field('Консультационные услуги за август 2026'),
    quantity: field('1'),
    unit: field('услуга'),
    unit_price: field('100000'),
    amount: field('100000'),
    vat_rate: field(''),
    vat_amount: field('')
  }];
}

function run(header, items) {
  const doc = buildActDoc({ header, items });
  return runRules(ACT_RULES, doc);
}

// quantity × price = amount; sum(lines) = subtotal; subtotal + VAT = total — all consistent → PASS
test('valid act: 1×100000=100000, +12000 VAT = 112000 → PASS', () => {
  const results = run(baseHeader(), baseItems());
  assert.equal(overallStatus(results), 'PASS');
  assert.ok(!results.some(r => r.status === 'FAILED'));
});

// line error: quantity=10, price=500, line amount=5500 (expected 5000)
test('line amount mismatch: 10 × 500 should be 5000, document shows 5500 → FAILED', () => {
  const items = [{
    description: field('Ремонтные работы'), quantity: field('10'), unit: field('час'),
    unit_price: field('500'), amount: field('5500'), vat_rate: field(''), vat_amount: field('')
  }];
  const results = run(baseHeader(), items);
  const lineResult = results.find(r => r.rule_id === 'ACT-002');
  assert.equal(lineResult.status, 'FAILED');
  assert.equal(lineResult.params.expected, 5000);
  assert.equal(lineResult.params.actual, 5500);
  assert.equal(lineResult.params.difference, 500);
});

// "subtotal + VAT = total" mismatch (ACT-004 — act has no separate
// base×rate=VAT rule, unlike INV-004 for ЭСФ, see rules/act.js comment)
test('subtotal + VAT mismatch → FAILED with expected/difference', () => {
  const results = run(baseHeader({ total: field('115000') }), baseItems());
  const totalResult = results.find(r => r.rule_id === 'ACT-004');
  assert.equal(totalResult.status, 'FAILED');
  assert.equal(totalResult.params.expected, 112000);
  assert.equal(totalResult.params.actual, 115000);
  assert.equal(totalResult.params.difference, 3000);
});

// sum(lines) ≈ subtotal
test('lines sum mismatch → FAILED', () => {
  const items = [{
    description: field('Услуга А'), quantity: field('1'), unit: field('услуга'),
    unit_price: field('90000'), amount: field('90000'), vat_rate: field(''), vat_amount: field('')
  }];
  // header subtotal stays 100000, but the single line only sums to 90000
  const results = run(baseHeader(), items);
  const sumResult = results.find(r => r.rule_id === 'ACT-003');
  assert.equal(sumResult.status, 'FAILED');
  assert.equal(sumResult.params.sum, 90000);
  assert.equal(sumResult.params.subtotal, 100000);
});

// missing required field must not produce a silent PASS
test('missing required field → FAILED, never a silent PASS', () => {
  const results = run(baseHeader({ buyer_inn: field('') }), baseItems());
  const req = results.find(r => r.rule_id === 'ACT-001' && r.params.field === 'buyer_inn');
  assert.equal(req.status, 'FAILED');
  assert.notEqual(overallStatus(results), 'PASS');
});

// missing data must not produce a false PASS
test('missing subtotal → INSUFFICIENT_DATA, not PASS', () => {
  const results = run(baseHeader({ subtotal: field('') }), baseItems());
  const sum = results.find(r => r.rule_id === 'ACT-003');
  const total = results.find(r => r.rule_id === 'ACT-004');
  assert.equal(sum.status, 'INSUFFICIENT_DATA');
  assert.equal(total.status, 'INSUFFICIENT_DATA');
  assert.equal(overallStatus(results), 'INSUFFICIENT_DATA');
});

// low extraction confidence must not be presented as certain
test('low-confidence field produces a WARNING, not a silent PASS', () => {
  const results = run(baseHeader({ contractor_inn: field('12345678901234', 40) }), baseItems());
  const conf = results.find(r => r.rule_id === 'ACT-CONF' && r.params.field === 'contractor_inn');
  assert.equal(conf.status, 'WARNING');
});

// INN format sanity check (WARNING, not ERROR — same as ACT-INN/NAK-INN/INV-INN convention)
test('malformed INN triggers a WARNING', () => {
  const results = run(baseHeader({ contractor_inn: field('12345') }), baseItems());
  const inn = results.find(r => r.rule_id === 'ACT-INN');
  assert.equal(inn.status, 'WARNING');
});

test('i18n render falls back to the key itself when no translation exists', () => {
  assert.equal(render('accounting.act.nonexistent_key', {}), 'accounting.act.nonexistent_key');
});
