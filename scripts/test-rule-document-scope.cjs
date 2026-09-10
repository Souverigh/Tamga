const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateBusinessRules } = require('../lib/clientConfigValidation');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('public/js/postprocess/businessRules.js', 'utf8').replace(/export /g, ''), context);
const check = context.checkBusinessRules;
const base = { type: 'required_field', field: 'ИНН', level: 'error' };

test('scope survives validation, supports multiple documents and multiple rules', () => {
  const { value, error } = validateBusinessRules([
    { ...base, docTypes: ['Акт', 'Накладная', 'Акт'] },
    { ...base, field: 'Номер', docTypes: ['Акт'] }
  ]);
  assert.equal(error, undefined);
  assert.deepEqual(value[0].docTypes, ['Акт', 'Накладная']);
  assert.equal(check([], value, 'Акт').length, 2);
  assert.equal(check([], value, 'Накладная').length, 1);
  assert.equal(check([], value, 'Паспорт').length, 0);
  assert.equal(check([], value).length, 0);
});

test('legacy rules apply to all documents; malformed scopes are rejected', () => {
  assert.equal(check([], validateBusinessRules([base]).value, 'Мой документ').length, 1);
  for (const docTypes of [[], null, 'Акт', [''], [1]]) {
    assert.ok(validateBusinessRules([{ ...base, docTypes }]).error);
  }
});
