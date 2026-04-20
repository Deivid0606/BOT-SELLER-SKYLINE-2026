-- Tabla de sesiones QR por vendedor
CREATE TABLE public.whatsapp_qr_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'disconnected', -- disconnected | pending_qr | connected
  connected_phone TEXT,
  last_qr TEXT,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_qr_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own QR session"
  ON public.whatsapp_qr_sessions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own QR session"
  ON public.whatsapp_qr_sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own QR session"
  ON public.whatsapp_qr_sessions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own QR session"
  ON public.whatsapp_qr_sessions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admin view all QR sessions"
  ON public.whatsapp_qr_sessions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_whatsapp_qr_sessions_updated_at
  BEFORE UPDATE ON public.whatsapp_qr_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabla de config global del servidor Baileys (solo admin)
CREATE TABLE public.baileys_server_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_url TEXT NOT NULL DEFAULT '',
  server_api_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.baileys_server_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin view baileys config"
  ON public.baileys_server_config FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin insert baileys config"
  ON public.baileys_server_config FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin update baileys config"
  ON public.baileys_server_config FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_baileys_server_config_updated_at
  BEFORE UPDATE ON public.baileys_server_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime para actualizaciones en vivo del estado QR
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_qr_sessions;