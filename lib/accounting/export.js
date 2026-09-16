// Excel-экспорт для бухгалтерского модуля — §20 хендовера, приоритет №1
// (Excel > PDF review report > Text > JSON — остальные форматы не в этом
// срезе). ОТДЕЛЬНЫЙ от lib/translation-templates и от существующего
// client-side DOCX-экспорта в public/js/translation/export.mjs (тот держит
// DOCX без библиотек прямо в браузере) — здесь наоборот: xlsx собирается на
// сервере через exceljs (первая npm-зависимость для accounting-модуля),
// потому что корректный .xlsx (типизированные числа/даты, а не просто CSV)
// сильно надёжнее для мастера "Загрузка данных из табличного документа" в
// 1С, чем текстовый файл — а самостоятельно собирать OOXML руками, как для
// DOCX, для xlsx избыточно.
//
// Вход — ТА ЖЕ форма, что уже возвращает /api/accounting/admin-recognize
// (doc_type, header, items, validation с готовым message, overall_status):
// "что видишь на экране — то и экспортируешь", без похода в Supabase за
// теми же данными по новой. Массовая выгрузка нескольких документов
// (Bulk-режим, §18) — Phase 6, не в этом срезе; buildAccountingWorkbook
// уже принимает МАССИВ документов заранее, чтобы это расширение не ломало
// сигнатуру.

const ExcelJS = require('exceljs');

// Общие для обоих типов документов подписи полей — тот же словарь, что в
// public/admin/accounting.js (HEADER_FIELD_LABELS), синхронизировать вручную
// при добавлении следующего Phase-4-типа.
const FIELD_LABELS = {
  invoice_number: 'Номер счёта',
  invoice_date: 'Дата',
  seller_name: 'Продавец',
  seller_inn: 'ИНН продавца',
  seller_bank_name: 'Банк продавца',
  seller_bik: 'БИК продавца',
  seller_account: 'Расчётный счёт продавца',
  seller_correspondent_account: 'Корр. счёт продавца',
  delivery_note_number: 'Номер накладной',
  delivery_note_date: 'Дата',
  supplier_name: 'Поставщик',
  supplier_inn: 'ИНН поставщика',
  supplier_bank_name: 'Банк поставщика',
  supplier_bik: 'БИК поставщика',
  supplier_account: 'Расчётный счёт поставщика',
  supplier_correspondent_account: 'Корр. счёт поставщика',
  act_number: 'Номер акта',
  act_date: 'Дата',
  contractor_name: 'Исполнитель',
  contractor_inn: 'ИНН исполнителя',
  contractor_bank_name: 'Банк исполнителя',
  contractor_bik: 'БИК исполнителя',
  contractor_account: 'Расчётный счёт исполнителя',
  contractor_correspondent_account: 'Корр. счёт исполнителя',
  payment_order_number: 'Номер платёжного поручения',
  payment_order_date: 'Дата',
  recipient_name: 'Получатель',
  recipient_inn: 'ИНН получателя',
  buyer_account: 'Счёт плательщика',
  recipient_account: 'Счёт получателя',
  payment_purpose: 'Назначение платежа',
  buyer_name: 'Покупатель',
  buyer_inn: 'ИНН покупателя',
  subtotal: 'Сумма без НДС',
  vat_rate: 'Ставка НДС',
  vat_total: 'Сумма НДС',
  total: 'Итого',
  currency: 'Валюта',
  additional_notes: 'Доп. текст (подпись/печать/реквизиты договора)'
};

const DOC_TYPE_LABELS = {
  esf: 'Счет-фактура / ЭСФ',
  nakladnaya: 'Товарная накладная',
  act: 'Акт выполненных работ',
  payment_order: 'Платёжное поручение'
};

function fieldValue(header, key) {
  const field = header?.[key];
  return field && field.value !== '' ? field.value : null;
}

function excelDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date;
}

// Числовые поля — записываются как настоящие Excel-числа (не текст), чтобы
// 1С и сам Excel сразу считали их числами, без ручной перетипизации после
// импорта. Даты — как строки YYYY-MM-DD (уже нормализованы в этом формате,
// см. normalization.js): часовой пояс/локаль Excel-даты внесли бы больше
// путаницы, чем однозначная ISO-строка.
const NUMERIC_HEADER_KEYS = new Set(['subtotal', 'vat_rate', 'vat_total', 'total']);

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Только не-PASS/не-NOT_APPLICABLE — тот же фильтр, что в renderRules
// (public/admin/accounting.js), проверки без замечаний в "Замечания" не
// дублируются, иначе колонка на PASS-документе всё равно распухает до
// нечитаемой простыни.
function warningsText(validation) {
  return (validation || [])
    .filter(r => r.status !== 'PASS' && r.status !== 'NOT_APPLICABLE')
    .map(r => r.message || `${r.rule_id}: ${r.status}`)
    .join('; ');
}

// documents — массив { docType, header, items, overallStatus, validation, fileName? }.
// Возвращает exceljs Workbook (вызывающий код сам решает — .xlsx.write в
// response stream, как в api/accounting/export.js).
function buildAccountingWorkbook(documents) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'АДРЕ';
  workbook.created = new Date();

  const docsSheet = workbook.addWorksheet('Документы');
  docsSheet.columns = [
    { header: 'Файл', key: 'file', width: 24 },
    { header: 'Тип документа', key: 'docType', width: 22 },
    { header: 'Номер', key: 'number', width: 16 },
    { header: 'Дата', key: 'date', width: 12 },
    { header: 'Продавец/Поставщик', key: 'seller', width: 28 },
    { header: 'ИНН продавца/поставщика', key: 'sellerInn', width: 18 },
    { header: 'Банк продавца/поставщика', key: 'sellerBankName', width: 24 },
    { header: 'БИК', key: 'sellerBik', width: 12 },
    { header: 'Расчётный счёт', key: 'sellerAccount', width: 20 },
    { header: 'Корр. счёт', key: 'sellerCorrespondentAccount', width: 20 },
    { header: 'Покупатель', key: 'buyer', width: 28 },
    { header: 'ИНН покупателя', key: 'buyerInn', width: 18 },
    { header: 'Сумма без НДС', key: 'subtotal', width: 16 },
    { header: 'Ставка НДС', key: 'vatRate', width: 12 },
    { header: 'Сумма НДС', key: 'vatTotal', width: 14 },
    { header: 'Итого', key: 'total', width: 14 },
    { header: 'Валюта', key: 'currency', width: 10 },
    { header: 'Доп. текст', key: 'additionalNotes', width: 50 },
    { header: 'Статус', key: 'status', width: 14 },
    { header: 'Замечания', key: 'warnings', width: 60 }
  ];
  docsSheet.getRow(1).font = { bold: true };

  const itemsSheet = workbook.addWorksheet('Строки');
  itemsSheet.columns = [
    { header: 'Файл', key: 'file', width: 24 },
    { header: 'Номер документа', key: 'number', width: 16 },
    { header: 'Наименование', key: 'description', width: 40 },
    { header: 'Кол-во', key: 'quantity', width: 10 },
    { header: 'Ед. изм.', key: 'unit', width: 12 },
    { header: 'Цена', key: 'unitPrice', width: 12 },
    { header: 'Сумма', key: 'amount', width: 14 },
    { header: 'Ставка НДС', key: 'vatRate', width: 12 },
    { header: 'Сумма НДС', key: 'vatAmount', width: 14 }
  ];
  itemsSheet.getRow(1).font = { bold: true };

  documents.forEach((doc, index) => {
    const { docType, header, items, overallStatus, validation, fileName } = doc;
    const file = fileName || `Документ ${index + 1}`;
    const number = fieldValue(header, 'invoice_number') || fieldValue(header, 'delivery_note_number') || fieldValue(header, 'act_number') || fieldValue(header, 'payment_order_number');
    const date = fieldValue(header, 'invoice_date') || fieldValue(header, 'delivery_note_date') || fieldValue(header, 'act_date') || fieldValue(header, 'payment_order_date');
    const seller = fieldValue(header, 'seller_name') || fieldValue(header, 'supplier_name') || fieldValue(header, 'contractor_name') || fieldValue(header, 'recipient_name');
    const sellerInn = fieldValue(header, 'seller_inn') || fieldValue(header, 'supplier_inn') || fieldValue(header, 'contractor_inn') || fieldValue(header, 'recipient_inn');
    const sellerBankName = fieldValue(header, 'seller_bank_name') || fieldValue(header, 'supplier_bank_name') || fieldValue(header, 'contractor_bank_name');
    const sellerBik = fieldValue(header, 'seller_bik') || fieldValue(header, 'supplier_bik') || fieldValue(header, 'contractor_bik');
    const sellerAccount = fieldValue(header, 'seller_account') || fieldValue(header, 'supplier_account') || fieldValue(header, 'contractor_account') || fieldValue(header, 'recipient_account');
    const sellerCorrespondentAccount = fieldValue(header, 'seller_correspondent_account') || fieldValue(header, 'supplier_correspondent_account') || fieldValue(header, 'contractor_correspondent_account');

    const documentRow = docsSheet.addRow({
      file,
      docType: DOC_TYPE_LABELS[docType] || docType,
      number,
      date: excelDate(date),
      seller,
      sellerInn,
      sellerBankName,
      sellerBik,
      sellerAccount,
      sellerCorrespondentAccount,
      buyer: fieldValue(header, 'buyer_name'),
      buyerInn: fieldValue(header, 'buyer_inn'),
      subtotal: toNumberOrNull(fieldValue(header, 'subtotal')),
      vatRate: toNumberOrNull(fieldValue(header, 'vat_rate')),
      vatTotal: toNumberOrNull(fieldValue(header, 'vat_total')),
      total: toNumberOrNull(fieldValue(header, 'total')),
      currency: fieldValue(header, 'currency'),
      additionalNotes: fieldValue(header, 'additional_notes'),
      status: overallStatus,
      warnings: warningsText(validation)
    });
    documentRow.getCell('date').numFmt = 'dd-mm-yy';

    for (const item of items || []) {
      itemsSheet.addRow({
        file,
        number,
        description: item.description?.value || null,
        quantity: toNumberOrNull(item.quantity?.value),
        unit: item.unit?.value || null,
        unitPrice: toNumberOrNull(item.unit_price?.value),
        amount: toNumberOrNull(item.amount?.value),
        vatRate: toNumberOrNull(item.vat_rate?.value),
        vatAmount: toNumberOrNull(item.vat_amount?.value)
      });
    }
  });

  docsSheet.addTable({
    name: 'AccountingDocuments',
    ref: `A1:T${Math.max(1, docsSheet.rowCount)}`,
    headerRow: true,
    columns: docsSheet.columns.map(column => ({ name: column.header })),
    rows: docsSheet.getRows(2, Math.max(0, docsSheet.rowCount - 1))?.map(row => row.values.slice(1)) || [],
    style: { theme: 'TableStyleMedium2', showRowStripes: true }
  });
  itemsSheet.addTable({
    name: 'AccountingItems',
    ref: `A1:I${Math.max(1, itemsSheet.rowCount)}`,
    headerRow: true,
    columns: itemsSheet.columns.map(column => ({ name: column.header })),
    rows: itemsSheet.getRows(2, Math.max(0, itemsSheet.rowCount - 1))?.map(row => row.values.slice(1)) || [],
    style: { theme: 'TableStyleMedium2', showRowStripes: true }
  });

  return workbook;
}

module.exports = { buildAccountingWorkbook, FIELD_LABELS, DOC_TYPE_LABELS };
