
-- 1. Tiempo de respuesta del bot en config
ALTER TABLE public.whatsapp_config
ADD COLUMN IF NOT EXISTS bot_response_delay_seconds INTEGER NOT NULL DEFAULT 30;

-- 2. Campañas de remarketing
CREATE TABLE IF NOT EXISTS public.remarketing_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  interval_days INTEGER NOT NULL DEFAULT 1,
  schedule_type TEXT NOT NULL DEFAULT 'days_hours',
  schedule_days TEXT[] NOT NULL DEFAULT '{}',
  schedule_time_from TEXT,
  schedule_time_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.remarketing_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own campaigns" ON public.remarketing_campaigns
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own campaigns" ON public.remarketing_campaigns
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own campaigns" ON public.remarketing_campaigns
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own campaigns" ON public.remarketing_campaigns
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admin view all campaigns" ON public.remarketing_campaigns
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_remarketing_campaigns_updated
  BEFORE UPDATE ON public.remarketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Tracking de envíos por campaña
CREATE TABLE IF NOT EXISTS public.remarketing_sends (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.remarketing_campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | delivered | failed | replied
  error TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remarketing_sends_campaign ON public.remarketing_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_remarketing_sends_user ON public.remarketing_sends(user_id);

ALTER TABLE public.remarketing_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own sends" ON public.remarketing_sends
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own sends" ON public.remarketing_sends
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own sends" ON public.remarketing_sends
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admin view all sends" ON public.remarketing_sends
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
