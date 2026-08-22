-- ============================================================
-- SYNCPOINT — Supabase Database Setup
-- Run this script in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ============================================================
-- TABLE: users  (custom auth — no Supabase Auth)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username     TEXT   UNIQUE NOT NULL,
  password     TEXT   NOT NULL,
  display_name TEXT,
  is_active    BOOLEAN     DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SEED USERS
-- ============================================================
INSERT INTO public.users (username, password, display_name)
VALUES
  ('pradeep', 'admin123', 'Pradeep'),
  ('praveen', 'admin123', 'Praveen')
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- TABLE: messages
-- ============================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id  BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  message    TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DISABLE Row Level Security (custom auth model)
-- ============================================================
ALTER TABLE public.users    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- ENABLE REALTIME on messages table
-- (Supabase Dashboard → Database → Replication → supabase_realtime)
-- OR run this SQL:
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages (created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id  ON public.messages (sender_id);

-- ============================================================
-- RPC FUNCTION: authenticate
-- Called by the app as: supabase.rpc('authenticate', { p_username, p_password })
-- Returns matching user row or empty set on failure.
-- ============================================================
CREATE OR REPLACE FUNCTION public.authenticate(p_username TEXT, p_password TEXT)
RETURNS TABLE (
  id           BIGINT,
  username     TEXT,
  display_name TEXT,
  is_active    BOOLEAN,
  created_at   TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT id, username, display_name, is_active, created_at
  FROM   public.users
  WHERE  users.username = p_username
    AND  users.password = p_password
    AND  users.is_active = TRUE;
$$;

-- ============================================================
-- VERIFICATION QUERIES (run separately to confirm)
-- ============================================================
-- SELECT * FROM public.users;
-- SELECT * FROM public.messages;
-- SELECT * FROM public.authenticate('pradeep', 'admin123');
