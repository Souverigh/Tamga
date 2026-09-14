const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkIdentifierFormat, checkExifSignals, checkForgerySignals } = require('../lib/postprocess/forgerySignals');

test('checkIdentifierFormat accepts valid КР (14) and РФ (10/12) digit lengths', () => {
  assert.deepEqual(checkIdentifierFormat([{ label: 'ПИН (ИНН)', value: '12345678901234' }]), []); // 14
  assert.deepEqual(checkIdentifierFormat([{ label: 'ИНН', value: '1234567890' }]), []); // 10
  assert.deepEqual(checkIdentifierFormat([{ label: 'ИНН', value: '123456789012' }]), []); // 12
});

test('checkIdentifierFormat flags wrong length', () => {
  const warnings = checkIdentifierFormat([{ label: 'ИНН', value: '123' }]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].level, 'suspicious');
  assert.match(warnings[0].message, /длина 3 цифр/);
});

test('checkIdentifierFormat flags non-digit characters', () => {
  const warnings = checkIdentifierFormat([{ label: 'ПИН (ИНН)', value: '1234567890123A' }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /не только цифры/);
});

test('checkIdentifierFormat ignores fields unrelated to ИНН/ПИН and empty values', () => {
  assert.deepEqual(checkIdentifierFormat([{ label: 'ФИО', value: '123' }, { label: 'ИНН', value: '' }]), []);
  assert.deepEqual(checkIdentifierFormat([]), []);
  assert.deepEqual(checkIdentifierFormat(null), []);
});

test('checkExifSignals skips non-JPEG mime types entirely', async () => {
  assert.deepEqual(await checkExifSignals('anything', 'image/png'), []);
  assert.deepEqual(await checkExifSignals('anything', 'application/pdf'), []);
});

test('checkExifSignals never throws on garbage JPEG bytes', async () => {
  const garbage = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]).toString('base64');
  assert.deepEqual(await checkExifSignals(garbage, 'image/jpeg'), []);
});

test('checkForgerySignals combines both checks and never throws', async () => {
  const result = await checkForgerySignals({
    base64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
    mimeType: 'image/jpeg',
    fields: [{ label: 'ИНН', value: 'not-a-number' }]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].level, 'suspicious');
});
