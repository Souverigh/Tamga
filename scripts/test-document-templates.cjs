const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeFingerprint, detectLang } = require('../lib/documentTemplates');

test('fingerprint is stable regardless of field order and case', () => {
  const a = [{ label: 'Сумма', value: '100' }, { label: 'Дата', value: '01.01.2026' }];
  const b = [{ label: 'дата', value: '02.02.2026' }, { label: 'СУММА', value: '200' }];
  assert.equal(computeFingerprint('Счёт-фактура', a), computeFingerprint('Счёт-фактура', b));
});

test('fingerprint differs for different doc types with the same fields', () => {
  const fields = [{ label: 'Сумма', value: '100' }];
  assert.notEqual(computeFingerprint('Счёт-фактура', fields), computeFingerprint('Акт', fields));
});

test('fingerprint differs when the set of field labels differs', () => {
  const a = [{ label: 'Сумма', value: '100' }];
  const b = [{ label: 'Сумма', value: '100' }, { label: 'Дата', value: '01.01.2026' }];
  assert.notEqual(computeFingerprint('Счёт-фактура', a), computeFingerprint('Счёт-фактура', b));
});

test('fingerprint ignores field VALUES, not just order — never leaks document content', () => {
  const a = [{ label: 'ФИО', value: 'Иванов Иван' }];
  const b = [{ label: 'ФИО', value: 'Петров Пётр' }];
  assert.equal(computeFingerprint('Паспорт', a), computeFingerprint('Паспорт', b));
});

test('detectLang recognizes Kyrgyz-specific letters over plain Cyrillic', () => {
  assert.equal(detectLang([{ label: 'Дата', value: 'Күнү' }]), 'ky');
});

test('detectLang recognizes CJK script', () => {
  assert.equal(detectLang([{ label: '姓名', value: '杨昭' }]), 'zh');
});

test('detectLang falls back to ru for plain Cyrillic and en otherwise', () => {
  assert.equal(detectLang([{ label: 'Сумма', value: '100' }]), 'ru');
  assert.equal(detectLang([{ label: 'Amount', value: '100' }]), 'en');
});

test('empty or missing fields never throw', () => {
  assert.equal(typeof computeFingerprint('Другое', []), 'string');
  assert.equal(detectLang([]), 'en');
  assert.equal(detectLang(undefined), 'en');
});
