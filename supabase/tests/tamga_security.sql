-- Run as database owner. No persistent synthetic usage remains.
BEGIN;
DO $$ DECLARE t record; f record; BEGIN
  FOR t IN SELECT c.oid,c.relrowsecurity,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'tamga_%'
  LOOP
    IF NOT t.relrowsecurity OR has_table_privilege('anon',t.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',t.oid,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Public table access: %', t.relname; END IF;
    IF NOT has_table_privilege('service_role',t.oid,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Backend blocked: %', t.relname; END IF;
  END LOOP;
  FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['consume_page_usage','consume_anonymous_page_usage','create_batch','record_batch_document','finish_batch','record_usage_event','get_usage_summary','is_rate_limited','record_auth_failure','consume_feedback_attempt','record_webhook_delivery','tamga_reserve_gemini_budget'])
  LOOP
    IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE') OR NOT has_function_privilege('service_role',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'RPC privilege mismatch: %', f.proname; END IF;
  END LOOP;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE a boolean; BEGIN
  SELECT allowed INTO a FROM public.tamga_reserve_gemini_budget(1,2147483647,2147483647);
  IF a IS DISTINCT FROM true THEN RAISE EXCEPTION 'Valid reservation failed'; END IF;
  SELECT allowed INTO a FROM public.tamga_reserve_gemini_budget(2147483647,2147483647,1);
  IF a IS DISTINCT FROM false THEN RAISE EXCEPTION 'Over-budget reservation allowed'; END IF;
END $$;
ROLLBACK;
