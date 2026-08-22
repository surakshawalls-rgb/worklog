-- ============================================================
-- MIGRATION 005: register_user RPC + delete_user_account RPC
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- register_user: inserts a new user and returns the created row.
-- Raises USERNAME_TAKEN or EMAIL_TAKEN on conflict so the app
-- can surface a specific error message.
DROP FUNCTION IF EXISTS public.register_user(TEXT, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.register_user(
  p_username     TEXT,
  p_display_name TEXT,
  p_email        TEXT,
  p_password     TEXT
)
RETURNS TABLE (
  id           BIGINT,
  username     TEXT,
  display_name TEXT,
  email        TEXT,
  is_active    BOOLEAN,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Username uniqueness check
  IF EXISTS (SELECT 1 FROM users WHERE users.username = p_username) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;

  -- Email uniqueness check
  IF EXISTS (SELECT 1 FROM users WHERE users.email = p_email) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN';
  END IF;

  RETURN QUERY
    INSERT INTO users (username, display_name, email, password, is_active)
    VALUES (p_username, p_display_name, p_email, p_password, TRUE)
    RETURNING
      users.id,
      users.username,
      users.display_name,
      users.email,
      users.is_active,
      users.created_at;
END;
$$;

-- delete_user_account: soft-deletes by setting is_active = FALSE,
-- preserving message history.
DROP FUNCTION IF EXISTS public.delete_user_account(BIGINT) CASCADE;
CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE users SET is_active = FALSE WHERE users.id = p_user_id;
END;
$$;

-- update_user_profile: updates display_name, email and/or password.
-- Returns the updated row. Raises EMAIL_TAKEN on conflict.
DROP FUNCTION IF EXISTS public.update_user_profile(BIGINT, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.update_user_profile(
  p_user_id      BIGINT,
  p_display_name TEXT,
  p_email        TEXT,
  p_password     TEXT
)
RETURNS TABLE (
  id           BIGINT,
  username     TEXT,
  display_name TEXT,
  email        TEXT,
  is_active    BOOLEAN,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Email uniqueness check (exclude current user)
  IF p_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM users WHERE users.email = p_email AND users.id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN';
  END IF;

  RETURN QUERY
    UPDATE users SET
      display_name = COALESCE(p_display_name, display_name),
      email        = COALESCE(p_email,        email),
      password     = COALESCE(p_password,     password)
    WHERE users.id = p_user_id
    RETURNING
      users.id,
      users.username,
      users.display_name,
      users.email,
      users.is_active,
      users.created_at;
END;
$$;
