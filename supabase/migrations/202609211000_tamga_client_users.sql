-- Отдельные пользователи (логин/пароль/роль) внутри клиента Tamga.
-- Таблица уже существует в проде (создана вручную вне трекаемых миграций 17 сен 2026);
-- эта миграция восстанавливает её схему в репозитории и приводит защиту доступа
-- к тому же стандарту, что и остальные tamga_* таблицы (202609100001_tamga_security.sql):
-- backend работает только через service_role, браузерный доступ не требуется.

CREATE TABLE IF NOT EXISTS public.tamga_client_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_slug text NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role = ANY (ARRAY['owner'::text, 'translator'::text])),
  translator_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tamga_client_users_client_slug_username_key UNIQUE (client_slug, username)
);

CREATE INDEX IF NOT EXISTS tamga_client_users_slug_idx ON public.tamga_client_users USING btree (client_slug);

ALTER TABLE public.tamga_client_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tamga_client_users FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tamga_client_users TO service_role;
