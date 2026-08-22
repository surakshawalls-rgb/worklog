-- Run this if the temporary attendance login was attempted before migration 008.
-- This is safe to run more than once.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee';

DO $$ BEGIN
  ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('employee', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.users (username, password, display_name, is_active, role)
VALUES ('9506629814', '9506629814', 'Attendance Admin', TRUE, 'admin')
ON CONFLICT (username) DO UPDATE
SET display_name = EXCLUDED.display_name,
    is_active = TRUE,
    role = 'admin';

SELECT id, username, display_name, email, is_active, role, created_at
FROM public.users
WHERE username = '9506629814';
