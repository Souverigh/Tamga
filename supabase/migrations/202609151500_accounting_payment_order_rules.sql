-- Регистр правил (accounting_rules_registry, создан в
-- 202609141200_accounting_esf.sql) — добавляет записи для PP-* (Платёжное
-- поручение, §21 Phase 4, третий и последний из Phase-4-типов, 15 сен 2026).
-- Только 3 правила — этот тип не имеет таблицы строк, поэтому нет
-- математических правил вроде NAK-002/003/004 или ACT-002/003/004.
INSERT INTO public.accounting_rules_registry (rule_id, category, severity, last_verified_at) VALUES
  ('PP-001', 'DOCUMENT_CONSISTENCY', 'ERROR', now()),
  ('PP-INN', 'DOCUMENT_CONSISTENCY', 'WARNING', now()),
  ('PP-CONF', 'DOCUMENT_CONSISTENCY', 'WARNING', now());
