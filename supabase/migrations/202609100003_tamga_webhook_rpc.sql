REVOKE ALL ON FUNCTION public.record_webhook_delivery(text,boolean,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_delivery(text,boolean,integer,text) TO service_role;
ALTER FUNCTION public.record_webhook_delivery(text,boolean,integer,text) SET search_path = public, pg_temp;
