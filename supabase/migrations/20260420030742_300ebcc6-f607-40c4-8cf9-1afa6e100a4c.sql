-- 1. Agregar columnas de notificación a whatsapp_config
ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS notify_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_channel text NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS notify_phones text[] NOT NULL DEFAULT '{}'::text[];

-- Validación: canal solo puede ser 'api' o 'qr'
ALTER TABLE public.whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_notify_channel_check;
ALTER TABLE public.whatsapp_config
  ADD CONSTRAINT whatsapp_config_notify_channel_check
  CHECK (notify_channel IN ('api', 'qr'));

-- 2. Función trigger que llama a edge function via pg_net cuando se crea una orden nueva
CREATE OR REPLACE FUNCTION public.notify_new_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_anon_key text;
BEGIN
  -- URL del edge function (hardcoded al project ref)
  v_project_url := 'https://kdqdilzgdwpgnafwvhvs.supabase.co/functions/v1/notify-order-confirmed';
  v_anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkcWRpbHpnZHdwZ25hZnd2aHZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxOTM4NTMsImV4cCI6MjA5MTc2OTg1M30.zx2h9bDeaVAPyQSeJBUeMS5PHZm65z3sX-EO0tU0r3o';

  -- Llamar a edge function (fire and forget)
  PERFORM net.http_post(
    url := v_project_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := jsonb_build_object('order_id', NEW.id, 'user_id', NEW.user_id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- No bloquear la inserción si falla la notificación
  RAISE WARNING 'notify_new_order error: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 3. Trigger: solo en INSERT
DROP TRIGGER IF EXISTS trg_notify_new_order ON public.orders;
CREATE TRIGGER trg_notify_new_order
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_order();

-- 4. Asegurar que la extensión pg_net esté habilitada
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;