-- ============================================================
-- MIGRATION 001: Auth Upgrade
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Add email column to users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

-- 2. Add password_reset_tokens table
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Index for fast token lookup
CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON public.password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user_id    ON public.password_reset_tokens (user_id);

-- 4. Disable RLS on all tables (custom auth model — no Supabase Auth)
ALTER TABLE public.users                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. GRANT permissions to anon + authenticated roles
--    Required for the Supabase JS client (anon key) to
--    INSERT / UPDATE rows without a service role key.
-- ============================================================
GRANT SELECT, INSERT, UPDATE ON public.users                  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.messages               TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.password_reset_tokens  TO anon, authenticated;

-- 6. Auto-cleanup expired/used tokens (run daily via pg_cron or manually)
-- DELETE FROM public.password_reset_tokens WHERE expires_at < NOW() OR used = TRUE;

