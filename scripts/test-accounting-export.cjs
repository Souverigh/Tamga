const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAccountingWorkbook } = require('../lib/accounting/export');

function field(value, confidence = 95) {
  return { value: String(value), raw_text: String(value), page: 1, confidence };
}

function sampleEsfDocument(overrides = {}) {
  return {
    docType: 'esf',
    header: {
      invoice_number: field('154'),
      invoice_date: field('2026-08-31'),
      seller_name: field('ОсОО «Ала-Тоо Сервис»'),
      seller_inn: field('12345678901234'),
      buyer_name: field('ОсОО «Нур Трейд»'),
      buyer_inn: field('98765432109876'),
      subtotal: field('100000'),
      vat_rate: field('0.12'),
      vat_total: field('12000'),
      total: field('112000'),
      currency: field('KGS')
    },
    items: [{
      description: field('Бумага офисная А4'),
      quantity: field('100'),
      unit_price: field('1000'),
      amount: field('100000'),
      vat_rate: field('0.12'),
      vat_amount: field('12000')
    }],
    overallStatus: 'PASS',
    validation: [
      { rule_id: 'INV-001', status: 'PASS', message: null },
      { rule_id: 'INV-002', status: 'PASS', message: null }
    ],
    fileName: 'invoice-154.pdf',
    ...overrides
  };
}

test('workbook has the two expected sheets, in order', () => {
  const workbook = buildAccountingWorkbook([sampleEsfDocument()]);
  const names = workbook.worksheets.map(ws => ws.name);
  assert.deepEqual(names, ['Документы', 'Строки']);
});

test('document row: header fields land in the right columns, numbers as real numbers', () => {
  const workbook = buildAccountingWorkbook([sampleEsfDocument()]);
  const docsSheet = workbook.getWorksheet('Документы');
  const row = docsSheet.getRow(2).values; // index 0 is unused by exceljs (1-indexed columns)
  assert.equal(docsSheet.getRow(2).getCell('file').value, 'invoice-154.pdf');
  assert.equal(docsSheet.getRow(2).getCell('docType').value, 'Счет-фактура / ЭСФ');
  assert.equal(docsSheet.getRow(2).getCell('number').value, '154');
  assert.equal(docsSheet.getRow(2).getCell('seller').value, 'ОсОО «Ала-Тоо Сервис»');
  const subtotalCell = docsSheet.getRow(2).getCell('subtotal');
  assert.equal(typeof subtotalCell.value, 'number');
  assert.equal(subtotalCell.value, 100000);
  assert.equal(docsSheet.getRow(2).getCell('status').value, 'PASS');
  void row;
});

test('накладная document: falls back to supplier_name/delivery_note_number columns', () => {
  const doc = sampleEsfDocument({
    docType: 'nakladnaya',
    header: {
      delivery_note_number: field('58'),
      delivery_note_date: field('2026-08-31'),
      supplier_name: field('ОсОО «Ала-Тоо Сервис»'),
      supplier_inn: field('12345678901234'),
      buyer_name: field('ОсОО «Нур Трейд»'),
      buyer_inn: field('98765432109876'),
      subtotal: field('100000'),
      vat_total: field('12000'),
      total: field('112000'),
      currency: field('KGS')
    }
  });
  const workbook = buildAccountingWorkbook([doc]);
  const docsSheet = workbook.getWorksheet('Документы');
  assert.equal(docsSheet.getRow(2).getCell('docType').value, 'Товарная накладная');
  assert.equal(docsSheet.getRow(2).getCell('number').value, '58');
  assert.equal(docsSheet.getRow(2).getCell('seller').value, 'ОсОО «Ала-Тоо Сервис»');
});

test('items sheet: one row per line item, numeric columns typed as numbers', () => {
  const workbook = buildAccountingWorkbook([sampleEsfDocument()]);
  const itemsSheet = workbook.getWorksheet('Строки');
  assert.equal(itemsSheet.rowCount, 2); // header + 1 item
  const row = itemsSheet.getRow(2);
  assert.equal(row.getCell('description').value, 'Бумага офисная А4');
  assert.equal(row.getCell('quantity').value, 100);
  assert.equal(typeof row.getCell('quantity').value, 'number');
  assert.equal(row.getCell('amount').value, 100000);
});

test('warnings column: only non-PASS/NOT_APPLICABLE messages, joined', () => {
  const doc = sampleEsfDocument({
    overallStatus: 'FAILED',
    validation: [
      { rule_id: 'INV-001', status: 'PASS', message: null },
      { rule_id: 'INV-002', status: 'FAILED', message: 'Кол-во × цена не совпадает с суммой' },
      { rule_id: 'INV-CONF', status: 'NOT_APPLICABLE', message: null },
      { rule_id: 'INV-INN', status: 'WARNING', message: 'ИНН не похож на корректный' }
    ]
  });
  const workbook = buildAccountingWorkbook([doc]);
  const docsSheet = workbook.getWorksheet('Документы');
  const warnings = docsSheet.getRow(2).getCell('warnings').value;
  assert.equal(warnings, 'Кол-во × цена не совпадает с суммой; ИНН не похож на корректный');
});

test('multiple documents produce one row each, in order', () => {
  const workbook = buildAccountingWorkbook([
    sampleEsfDocument({ fileName: 'a.pdf' }),
    sampleEsfDocument({ fileName: 'b.pdf' })
  ]);
  const docsSheet = workbook.getWorksheet('Документы');
  assert.equal(docsSheet.rowCount, 3); // header + 2 documents
  assert.equal(docsSheet.getRow(2).getCell('file').value, 'a.pdf');
  assert.equal(docsSheet.getRow(3).getCell('file').value, 'b.pdf');
});

// Bank requisites (15 сен 2026, Ethan) — отдельные структурные поля у ЭСФ/
// накладной/акта, плюс общий additional_notes catch-all во всех 4 типах.
test('bank requisites and additional_notes land in the right columns', () => {
  const doc = sampleEsfDocument({
    header: {
      invoice_number: field('154'),
      invoice_date: field('2026-08-31'),
      seller_name: field('ОсОО «Ала-Тоо Сервис»'),
      seller_inn: field('12345678901234'),
      seller_bank_name: field('РСК Банк'),
      seller_bik: field('129001'),
      seller_account: field('1234567890123456'),
      seller_correspondent_account: field('30101810000000000601'),
      buyer_name: field('ОсОО «Нур Трейд»'),
      buyer_inn: field('98765432109876'),
      subtotal: field('100000'),
      vat_rate: field('0.12'),
      vat_total: field('12000'),
      total: field('112000'),
      currency: field('KGS'),
      additional_notes: field('Подписал: Иванов И.И., директор. По Договору №12 от 01.08.2026')
    }
  });
  const workbook = buildAccountingWorkbook([doc]);
  const docsSheet = workbook.getWorksheet('Документы');
  assert.equal(docsSheet.getRow(2).getCell('sellerBankName').value, 'РСК Банк');
  assert.equal(docsSheet.getRow(2).getCell('sellerBik').value, '129001');
  assert.equal(docsSheet.getRow(2).getCell('sellerAccount').value, '1234567890123456');
  assert.equal(docsSheet.getRow(2).getCell('sellerCorrespondentAccount').value, '30101810000000000601');
  assert.equal(docsSheet.getRow(2).getCell('additionalNotes').value, 'Подписал: Иванов И.И., директор. По Договору №12 от 01.08.2026');
});
