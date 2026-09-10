const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('rule field catalog follows document schemas, overrides and custom document edits', () => {
  const schema = fs.readFileSync('public/js/config/docSchema.js', 'utf8').replace(/export /g, '');
  const source = fs.readFileSync('public/settings/settings.js', 'utf8');
  const catalogFunction = source.slice(source.indexOf('function ruleFieldCatalog()'), source.indexOf('function refreshRuleFieldPickers()'));
  const state = { fieldOverrides: {}, customDocTypes: {} };
  const context = vm.createContext({ state });
  vm.runInContext(schema + '\n' + catalogFunction, context);
  const catalog = () => vm.runInContext('ruleFieldCatalog()', context);
  assert.ok(catalog().has('ФИО'));
  assert.ok(catalog().has('Наименование'));
  state.customDocTypes['Мой документ'] = { fields: ['Новое поле', 'ФИО'] };
  assert.ok(catalog().get('ФИО').includes('Мой документ'));
  assert.ok(catalog().has('Новое поле'));
  state.customDocTypes['Мой документ'].fields = ['Обновлённое поле'];
  assert.ok(catalog().has('Обновлённое поле'));
  assert.equal(catalog().has('Новое поле'), false);
  state.fieldOverrides['Другое'] = ['Поле переопределения'];
  assert.ok(catalog().has('Поле переопределения'));
  assert.equal(catalog().has('Краткое содержание'), false);
  delete state.fieldOverrides['Другое'];
  assert.ok(catalog().has('Краткое содержание'));
  delete state.customDocTypes['Мой документ'];
  assert.equal(catalog().has('Обновлённое поле'), false);
});
