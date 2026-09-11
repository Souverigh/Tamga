-- Tamga backend uses service_role exclusively. No browser access is required.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT c.oid::regclass AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY(ARRAY['tamga_anonymous_usage','tamga_api_key_fields','tamga_auth_attempts','tamga_batches','tamga_feedback','tamga_feedback_attempts','tamga_usage_daily'])
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', item.name);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', item.name);
    EXECUTE format('GRANT ALL ON TABLE %s TO service_role', item.name);
  END LOOP;
  FOR item IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname = ANY(ARRAY['consume_page_usage','consume_anonymous_page_usage','create_batch','record_batch_document','finish_batch','record_usage_event','get_usage_summary','is_rate_limited','record_auth_failure','consume_feedback_attempt'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', item.name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', item.name);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', item.name);
  END LOOP;
END $$;
