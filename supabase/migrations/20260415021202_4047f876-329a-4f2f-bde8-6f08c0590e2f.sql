
-- Add user management fields to profiles
ALTER TABLE public.profiles
ADD COLUMN approved boolean NOT NULL DEFAULT false,
ADD COLUMN active boolean NOT NULL DEFAULT true,
ADD COLUMN active_from date DEFAULT NULL,
ADD COLUMN active_until date DEFAULT NULL,
ADD COLUMN inactive_message text DEFAULT NULL;

-- Allow admins to update any profile (for approving/disabling users)
CREATE POLICY "Admin can update all profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to view all profiles (already exists but let's ensure)
CREATE POLICY "Admin can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
