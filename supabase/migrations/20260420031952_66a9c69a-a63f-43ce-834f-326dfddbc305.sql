-- Wipe operativo
TRUNCATE TABLE public.remarketing_sends RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.remarketing_campaigns RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.orders RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.whatsapp_qr_sessions RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.whatsapp_config RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.baileys_server_config RESTART IDENTITY CASCADE;

-- Wipe usuarios (cascade borra profiles, user_roles vía FK a auth.users)
TRUNCATE TABLE public.user_roles RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.profiles RESTART IDENTITY CASCADE;
DELETE FROM auth.users;