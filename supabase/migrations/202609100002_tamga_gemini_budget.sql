CREATE TABLE public.tamga_gemini_budget (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  window_start timestamptz NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  tokens bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.tamga_gemini_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tamga_gemini_budget FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tamga_gemini_budget TO service_role;

CREATE FUNCTION public.tamga_reserve_gemini_budget(p_tokens integer, p_rpm integer, p_tpm integer)
RETURNS TABLE(allowed boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r public.tamga_gemini_budget%ROWTYPE;
BEGIN
  IF p_tokens IS NULL OR p_rpm IS NULL OR p_tpm IS NULL OR p_tokens < 1 OR p_rpm < 1 OR p_tpm < 1 THEN
    RAISE EXCEPTION 'invalid budget';
  END IF;
  INSERT INTO public.tamga_gemini_budget(id, window_start) VALUES(true, clock_timestamp()) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM public.tamga_gemini_budget WHERE id FOR UPDATE;
  IF r.window_start <= clock_timestamp() - interval '60 seconds' THEN
    r.window_start := clock_timestamp(); r.requests := 0; r.tokens := 0;
  END IF;
  IF r.requests >= p_rpm OR r.tokens + p_tokens > p_tpm THEN RETURN QUERY SELECT false; RETURN; END IF;
  UPDATE public.tamga_gemini_budget SET window_start=r.window_start, requests=r.requests+1, tokens=r.tokens+p_tokens WHERE id;
  RETURN QUERY SELECT true;
END $$;
REVOKE ALL ON FUNCTION public.tamga_reserve_gemini_budget(integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tamga_reserve_gemini_budget(integer,integer,integer) TO service_role;
