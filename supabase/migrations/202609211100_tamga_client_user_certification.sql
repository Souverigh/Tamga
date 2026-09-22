-- Личный вариант приписки переводчика (Ethan, 21 сен 2026: "чтобы переводчики
-- сами могли изменить, иметь свой вариант приписки") — те же поля, что и у
-- общей приписки клиента (tamga_api_key_fields.formatting.certification), но
-- персонально на пользователя. NULL/{} — переводчик своего варианта не задал,
-- используется общий вариант клиента (см. api/client-profile.js,
-- public/js/translationDocs/panel.js).
ALTER TABLE public.tamga_client_users ADD COLUMN IF NOT EXISTS certification jsonb;
