-- ============================================================
-- MIGRATION 006: Disable RLS on all tables
-- Supabase silently re-enables RLS — this migration ensures
-- all tables are explicitly set back to disabled.
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================
ALTER TABLE public.users                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_activity_events DISABLE ROW LEVEL SECURITY;
