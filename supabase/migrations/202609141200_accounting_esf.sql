-- Модуль бухгалтерии (ADRE_Accounting_Handover.md) — первый срез, ЭСФ.
--
-- ВАЖНО (Ethan, 14 сен 2026, "оригинальный код на гитхабе не меняй"): новые
-- таблицы, отдельный префикс accounting_* — не пересекаются с tamga_*.
-- Существующие таблицы/миграции этим файлом не затрагиваются.
--
-- RLS-паттерн — тот же, что у остальных таблиц Tamga (service_role only,
-- без политик для anon/authenticated, см. 202609100001_tamga_security.sql):
-- бэкенд обращается через service_role (Vercel Functions), браузер напрямую
-- в Supabase не ходит.

CREATE TABLE public.accounting_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_ref text,
  doc_type text NOT NULL DEFAULT 'esf',
  header jsonb NOT NULL,              -- сырые provenance-поля {value, raw_text, page, confidence}
  header_normalized jsonb NOT NULL,   -- те же поля после normalization.js (числа/ISO-даты/null)
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  items_normalized jsonb NOT NULL DEFAULT '[]'::jsonb,
  overall_status text NOT NULL,       -- PASS | FAILED | WARNING | NOT_APPLICABLE | INSUFFICIENT_DATA
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX accounting_documents_client_ref_idx ON public.accounting_documents (client_ref);
CREATE INDEX accounting_documents_created_at_idx ON public.accounting_documents (created_at DESC);

CREATE TABLE public.accounting_rule_results (
  id bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES public.accounting_documents (id) ON DELETE CASCADE,
  rule_id text NOT NULL,
  category text NOT NULL,             -- MATHEMATICAL | DOCUMENT_CONSISTENCY | REGULATORY | CROSS_DOCUMENT
  severity text,                      -- INFO | WARNING | ERROR | CRITICAL | null (PASS/NOT_APPLICABLE)
  status text NOT NULL,               -- PASS | FAILED | WARNING | NOT_APPLICABLE | INSUFFICIENT_DATA
  message_key text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX accounting_rule_results_document_id_idx ON public.accounting_rule_results (document_id);

-- §3 хендовера: каждое регуляторное правило хранит source/version/даты
-- действия/когда в последний раз сверено с источником. Первый срез (ЭСФ)
-- пока не содержит ни одного REGULATORY-правила (INV-001..006 — MATHEMATICAL/
-- DOCUMENT_CONSISTENCY) — таблица создаётся сейчас, чтобы не было отдельной
-- миграции при первом REGULATORY-правиле.
CREATE TABLE public.accounting_rules_registry (
  rule_id text PRIMARY KEY,
  category text NOT NULL,
  severity text NOT NULL,
  source_name text,
  source_version text,
  effective_from date,
  effective_to date,
  last_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- §17: каждая ручная правка бухгалтера — с исходным значением модели и её
-- confidence, для будущей оценки/дообучения.
CREATE TABLE public.accounting_corrections (
  id bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES public.accounting_documents (id) ON DELETE CASCADE,
  field text NOT NULL,
  model_value text,
  corrected_value text NOT NULL,
  model_confidence integer,
  corrected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX accounting_corrections_document_id_idx ON public.accounting_corrections (document_id);

ALTER TABLE public.accounting_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_rule_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_rules_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_corrections ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.accounting_documents TO service_role;
GRANT ALL ON public.accounting_rule_results TO service_role;
GRANT ALL ON public.accounting_rules_registry TO service_role;
GRANT ALL ON public.accounting_corrections TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.accounting_rule_results_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.accounting_corrections_id_seq TO service_role;

-- Реестр правил первого среза (§3/§10) — только MATHEMATICAL/DOCUMENT_CONSISTENCY,
-- source полей нет (не регуляторные).
INSERT INTO public.accounting_rules_registry (rule_id, category, severity, last_verified_at) VALUES
  ('INV-001', 'DOCUMENT_CONSISTENCY', 'ERROR', now()),
  ('INV-INN', 'DOCUMENT_CONSISTENCY', 'WARNING', now()),
  ('INV-002', 'MATHEMATICAL', 'ERROR', now()),
  ('INV-003', 'MATHEMATICAL', 'ERROR', now()),
  ('INV-004', 'MATHEMATICAL', 'ERROR', now()),
  ('INV-005', 'MATHEMATICAL', 'ERROR', now()),
  ('INV-006', 'MATHEMATICAL', 'WARNING', now()),
  ('INV-CONF', 'DOCUMENT_CONSISTENCY', 'WARNING', now());
