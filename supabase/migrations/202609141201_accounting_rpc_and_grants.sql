-- Дополняет 202609141200_accounting_esf.sql: явный REVOKE ALL FROM PUBLIC,
-- anon, authenticated на новых таблицах (тот же defense-in-depth, что в
-- 202609100001_tamga_security.sql — RLS без policy уже блокирует эти роли,
-- явный REVOKE делает это неявное поведение явным и не зависящим от RLS).
--
-- Плюс RPC-функции для записи — по образцу tamga_reserve_gemini_budget:
-- атомарная вставка документа + его rule-результатов одним вызовом, а не
-- отдельными PostgREST-запросами на таблицу (тот же паттерн для записи,
-- что уже используют lib/documentTemplates.js / lib/webhookBatches.js).

REVOKE ALL ON TABLE public.accounting_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.accounting_rule_results FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.accounting_rules_registry FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.accounting_corrections FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_accounting_document(
  p_client_ref text,
  p_doc_type text,
  p_header jsonb,
  p_header_normalized jsonb,
  p_items jsonb,
  p_items_normalized jsonb,
  p_overall_status text,
  p_rule_results jsonb -- массив объектов {rule_id, category, severity, status, message_key, params}
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_document_id uuid;
BEGIN
  INSERT INTO public.accounting_documents
    (client_ref, doc_type, header, header_normalized, items, items_normalized, overall_status)
  VALUES
    (p_client_ref, p_doc_type, p_header, p_header_normalized, p_items, p_items_normalized, p_overall_status)
  RETURNING id INTO v_document_id;

  INSERT INTO public.accounting_rule_results (document_id, rule_id, category, severity, status, message_key, params)
  SELECT
    v_document_id,
    r->>'rule_id',
    r->>'category',
    r->>'severity',
    r->>'status',
    r->>'message_key',
    COALESCE(r->'params', '{}'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_rule_results, '[]'::jsonb)) AS r;

  RETURN v_document_id;
END $$;

REVOKE ALL ON FUNCTION public.record_accounting_document(text,text,jsonb,jsonb,jsonb,jsonb,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_accounting_document(text,text,jsonb,jsonb,jsonb,jsonb,text,jsonb) TO service_role;

CREATE FUNCTION public.record_accounting_correction(
  p_document_id uuid,
  p_field text,
  p_model_value text,
  p_corrected_value text,
  p_model_confidence integer
)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.accounting_corrections (document_id, field, model_value, corrected_value, model_confidence)
  VALUES (p_document_id, p_field, p_model_value, p_corrected_value, p_model_confidence)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.record_accounting_correction(uuid,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_accounting_correction(uuid,text,text,text,integer) TO service_role;
