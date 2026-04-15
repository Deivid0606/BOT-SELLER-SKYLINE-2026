
-- WhatsApp config per user
CREATE TABLE public.whatsapp_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number_id TEXT DEFAULT '',
  business_account_id TEXT DEFAULT '',
  meta_app_id TEXT DEFAULT '',
  permanent_token TEXT DEFAULT '',
  webhook_url TEXT NOT NULL,
  webhook_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own config" ON public.whatsapp_config FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own config" ON public.whatsapp_config FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own config" ON public.whatsapp_config FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Update handle_new_user to also create whatsapp_config
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INT;
  assigned_role app_role;
  wh_id TEXT;
  wh_token TEXT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  IF user_count = 0 THEN
    assigned_role := 'admin';
  ELSE
    assigned_role := 'vendedor';
  END IF;

  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);

  -- Generate unique webhook URL id and token
  wh_id := replace(gen_random_uuid()::text, '-', '');
  wh_token := substr(encode(gen_random_bytes(16), 'hex'), 1, 24);

  INSERT INTO public.whatsapp_config (user_id, webhook_url, webhook_token)
  VALUES (NEW.id, wh_id, wh_token);

  RETURN NEW;
END;
$$;

CREATE TRIGGER update_whatsapp_config_updated_at BEFORE UPDATE ON public.whatsapp_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
