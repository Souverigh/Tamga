// public/admin/accounting/labels.js — человеко-читаемые подписи для
// review-экрана (public/admin/accounting.html). Вынесено из accounting.js
// 15 сен 2026 (Ethan: "разделить на модульные сегменты, которые можно
// переиспользовать") — чистые данные, ничего не знают про DOM/fetch, поэтому
// первый кандидат на отдельный модуль. ES-модули нативно, без сборщика — как
// и раньше в проекте (../../js/idleSession.js тем же способом).

// Один общий словарь на все 4 типа документов (backend отдаёт только поля,
// реально принадлежащие определённому doc_type — см. splitRawResult в
// lib/accounting/pipeline.js, — так что пересечения ключей здесь не создают
// путаницы: для конкретного результата в header присутствуют только его
// собственные поля).
export const HEADER_FIELD_LABELS = {
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

export const DOC_TYPE_LABELS = {
  esf: 'Счет-фактура / ЭСФ',
  nakladnaya: 'Товарная накладная',
  act: 'Акт выполненных работ',
  payment_order: 'Платёжное поручение'
};

// Человеко-читаемые названия правил для интерфейса — только для отображения.
// Сам rule_id (INV-002, NAK-002...) остаётся техническим идентификатором:
// он же хранится в Supabase (accounting_rules_registry, accounting_rule_results),
// на него ссылаются тесты и миграции — трогать его ради читаемости UI не
// стали (Ethan, 14 сен 2026: "только подпись в интерфейсе").
export const RULE_LABELS = {
  'INV-001': 'Обязательные поля',
  'INV-INN': 'Формат ИНН',
  'INV-002': 'Кол-во × цена = сумма строки',
  'INV-003': 'Сумма строк = сумма без НДС',
  'INV-004': 'База × ставка НДС = сумма НДС',
  'INV-005': 'Сумма без НДС + НДС = итого',
  'INV-006': 'Сумма НДС по строкам = НДС документа',
  'INV-CONF': 'Уверенность распознавания',
  'NAK-001': 'Обязательные поля',
  'NAK-INN': 'Формат ИНН',
  'NAK-002': 'Кол-во × цена = сумма строки',
  'NAK-003': 'Сумма строк = сумма без НДС',
  'NAK-004': 'Сумма без НДС + НДС = итого',
  'NAK-CONF': 'Уверенность распознавания',
  'ACT-001': 'Обязательные поля',
  'ACT-INN': 'Формат ИНН',
  'ACT-002': 'Кол-во × цена = сумма строки',
  'ACT-003': 'Сумма строк = сумма без НДС',
  'ACT-004': 'Сумма без НДС + НДС = итого',
  'ACT-CONF': 'Уверенность распознавания',
  'PP-001': 'Обязательные поля',
  'PP-INN': 'Формат ИНН',
  'PP-CONF': 'Уверенность распознавания'
};

export const FILE_STATUS_LABELS = {
  pending: 'В очереди',
  recognizing: 'Обрабатываем...',
  done: 'Готово',
  error: 'Ошибка обработки',
  insufficient_data: 'Недостаточно данных'
};

export const LOW_CONFIDENCE_THRESHOLD = 70;
