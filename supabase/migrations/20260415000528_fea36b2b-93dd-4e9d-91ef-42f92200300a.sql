
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

  wh_id := replace(gen_random_uuid()::text, '-', '');
  wh_token := substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 24);

  INSERT INTO public.whatsapp_config (user_id, webhook_url, webhook_token)
  VALUES (NEW.id, wh_id, wh_token);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user error: % %', SQLERRM, SQLSTATE;
  RAISE;
END;
$$;
