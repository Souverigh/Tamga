-- Регистр правил (accounting_rules_registry, создан в
-- 202609141200_accounting_esf.sql) — добавляет записи для NAK-* (Товарная
-- накладная, §8 хендовера, первый Phase-4-тип, 14 сен 2026). Только
-- MATHEMATICAL/DOCUMENT_CONSISTENCY, как и у ЭСФ — регуляторных правил с
-- source/version пока нет ни у одного типа.
INSERT INTO public.accounting_rules_registry (rule_id, category, severity, last_verified_at) VALUES
  ('NAK-001', 'DOCUMENT_CONSISTENCY', 'ERROR', now()),
  ('NAK-INN', 'DOCUMENT_CONSISTENCY', 'WARNING', now()),
  ('NAK-002', 'MATHEMATICAL', 'ERROR', now()),
  ('NAK-003', 'MATHEMATICAL', 'ERROR', now()),
  ('NAK-004', 'MATHEMATICAL', 'ERROR', now()),
  ('NAK-CONF', 'DOCUMENT_CONSISTENCY', 'WARNING', now());
