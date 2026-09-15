-- Регистр правил (accounting_rules_registry, создан в
-- 202609141200_accounting_esf.sql) — добавляет записи для ACT-* (Акт
-- выполненных работ, §21 Phase 4, второй из трёх оставшихся Phase-4-типов,
-- 15 сен 2026). Только MATHEMATICAL/DOCUMENT_CONSISTENCY, как и у ЭСФ/
-- накладной — регуляторных правил с source/version пока нет ни у одного типа.
INSERT INTO public.accounting_rules_registry (rule_id, category, severity, last_verified_at) VALUES
  ('ACT-001', 'DOCUMENT_CONSISTENCY', 'ERROR', now()),
  ('ACT-INN', 'DOCUMENT_CONSISTENCY', 'WARNING', now()),
  ('ACT-002', 'MATHEMATICAL', 'ERROR', now()),
  ('ACT-003', 'MATHEMATICAL', 'ERROR', now()),
  ('ACT-004', 'MATHEMATICAL', 'ERROR', now()),
  ('ACT-CONF', 'DOCUMENT_CONSISTENCY', 'WARNING', now());
