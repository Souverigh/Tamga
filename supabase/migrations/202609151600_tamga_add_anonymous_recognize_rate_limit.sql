-- Троттлинг запросов на распознавание — ТОЛЬКО для бесплатного анонимного
-- тарифа сайта (Ethan, 15 сен 2026: "сделай только для бесплатной версии").
-- Отдельная таблица/функция от tamga_feedback_attempts (разные по смыслу
-- счётчики, тот же принцип разделения, что и раньше в проекте) — тот же
-- паттерн "считаем КАЖДУЮ попытку, не только неудачные" (consume_feedback_attempt),
-- т.к. иначе скрипт мог бы просто продолжать "успешно" долбить эндпоинт.

CREATE TABLE public.tamga_recognize_attempts (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0
);

ALTER TABLE public.tamga_recognize_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tamga_recognize_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tamga_recognize_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.consume_recognize_attempt(p_key text, p_window_seconds integer, p_max_attempts integer)
 RETURNS TABLE(allowed boolean, retry_after_seconds integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  rec record;
  elapsed_seconds integer;
begin
  insert into tamga_recognize_attempts (key, window_start, attempt_count)
  values (p_key, now(), 0)
  on conflict (key) do nothing;

  select * into rec from tamga_recognize_attempts where key = p_key for update;
  elapsed_seconds := extract(epoch from (now() - rec.window_start))::integer;

  if elapsed_seconds > p_window_seconds then
    update tamga_recognize_attempts set window_start = now(), attempt_count = 1 where key = p_key;
    return query select true, 0;
    return;
  end if;

  if rec.attempt_count >= p_max_attempts then
    return query select false, greatest(0, p_window_seconds - elapsed_seconds);
    return;
  end if;

  update tamga_recognize_attempts set attempt_count = rec.attempt_count + 1 where key = p_key;
  return query select true, 0;
end;
$function$;

REVOKE ALL ON FUNCTION public.consume_recognize_attempt(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_recognize_attempt(text, integer, integer) TO service_role;
