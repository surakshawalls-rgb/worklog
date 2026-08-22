-- ============================================================
-- SYNCPOINT — Clean Database Reset
-- Drops all app tables, functions, and indexes, then
-- recreates the full schema fresh with zero data.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- WARNING: This deletes ALL existing data permanently.
-- ============================================================

-- ============================================================
-- STEP 1: Drop all RPC functions
-- ============================================================
DROP FUNCTION IF EXISTS public.authenticate(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_or_create_conversation(BIGINT, BIGINT) CASCADE;
DROP FUNCTION IF EXISTS public.send_friend_request(BIGINT, BIGINT) CASCADE;
DROP FUNCTION IF EXISTS public.respond_to_request(BIGINT, BIGINT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_conversations(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS public.search_users(TEXT, BIGINT) CASCADE;
DROP FUNCTION IF EXISTS public.get_pending_requests(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS public.get_contacts(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS public.send_dm(BIGINT, BIGINT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.toggle_reaction(BIGINT, BIGINT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.register_user(TEXT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.delete_user_account(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS public.update_user_profile(BIGINT, TEXT, TEXT, TEXT) CASCADE;

-- ============================================================
-- STEP 2: Drop all tables (CASCADE handles FK deps)
-- ============================================================
DROP TABLE IF EXISTS public.device_activity_events  CASCADE;
DROP TABLE IF EXISTS public.password_reset_tokens   CASCADE;
DROP TABLE IF EXISTS public.message_reactions        CASCADE;
DROP TABLE IF EXISTS public.messages                CASCADE;
DROP TABLE IF EXISTS public.conversations           CASCADE;
DROP TABLE IF EXISTS public.friendships             CASCADE;
DROP TABLE IF EXISTS public.users                   CASCADE;

-- ============================================================
-- STEP 3: Recreate tables
-- ============================================================

-- users
CREATE TABLE public.users (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username     TEXT        UNIQUE NOT NULL,
  password     TEXT        NOT NULL,
  display_name TEXT,
  is_active    BOOLEAN     DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  email        TEXT        UNIQUE
);
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.users TO anon, authenticated;

-- messages
CREATE TABLE public.messages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id       BIGINT      REFERENCES public.users(id) ON DELETE SET NULL,
  message         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  conversation_id BIGINT,
  read_at         TIMESTAMPTZ
);
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.messages TO anon, authenticated;

-- conversations
CREATE TABLE public.conversations (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_1   BIGINT      NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  participant_2   BIGINT      NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_participants CHECK (participant_1 < participant_2),
  CONSTRAINT uq_conversation  UNIQUE (participant_1, participant_2)
);
ALTER TABLE public.conversations DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO anon, authenticated;

-- Add FK from messages → conversations
ALTER TABLE public.messages
  ADD CONSTRAINT fk_msg_conversation
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

-- friendships
CREATE TABLE public.friendships (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  addressee_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       TEXT   NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_no_self_friend CHECK (requester_id <> addressee_id),
  CONSTRAINT uq_friendship      UNIQUE (requester_id, addressee_id)
);
ALTER TABLE public.friendships DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO anon, authenticated;

-- password_reset_tokens
CREATE TABLE public.password_reset_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.password_reset_tokens DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.password_reset_tokens TO anon, authenticated;

-- device_activity_events
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.device_activity_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type            TEXT   NOT NULL CHECK (event_type IN ('call_log', 'location')),
  occurred_at           TIMESTAMPTZ NOT NULL,
  call_direction        TEXT   CHECK (call_direction IN ('incoming','outgoing','missed','rejected','blocked')),
  counterparty_number   TEXT,
  call_duration_seconds INTEGER CHECK (call_duration_seconds IS NULL OR call_duration_seconds >= 0),
  latitude              DOUBLE PRECISION,
  longitude             DOUBLE PRECISION,
  accuracy_meters       REAL   CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  device_event_id       TEXT   NOT NULL,
  source                TEXT   NOT NULL DEFAULT 'android',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT device_activity_event_shape CHECK (
    (event_type = 'call_log' AND latitude IS NULL AND longitude IS NULL) OR
    (event_type = 'location' AND call_direction IS NULL AND counterparty_number IS NULL
      AND call_duration_seconds IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL)
  ),
  CONSTRAINT uq_device_activity_events_device_event UNIQUE (user_id, device_event_id)
);
ALTER TABLE public.device_activity_events DISABLE ROW LEVEL SECURITY;

-- message_reactions
CREATE TABLE public.message_reactions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  emoji      TEXT   NOT NULL CHECK (char_length(emoji) <= 10),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_reaction UNIQUE (message_id, user_id, emoji)
);
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.message_reactions DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.message_reactions TO anon, authenticated;

-- ============================================================
-- STEP 4: Recreate indexes
-- ============================================================
CREATE INDEX idx_messages_created_at      ON public.messages (created_at ASC);
CREATE INDEX idx_messages_sender_id       ON public.messages (sender_id);
CREATE INDEX idx_messages_conv_id         ON public.messages (conversation_id, created_at ASC);
CREATE INDEX idx_conv_p1                  ON public.conversations (participant_1);
CREATE INDEX idx_conv_p2                  ON public.conversations (participant_2);
CREATE INDEX idx_friendships_requester    ON public.friendships (requester_id);
CREATE INDEX idx_friendships_addressee    ON public.friendships (addressee_id);
CREATE INDEX idx_friendships_status       ON public.friendships (status);
CREATE INDEX idx_prt_token_hash           ON public.password_reset_tokens (token_hash);
CREATE INDEX idx_prt_user_id              ON public.password_reset_tokens (user_id);
CREATE INDEX idx_device_activity_events_user_time ON public.device_activity_events (user_id, occurred_at DESC);
CREATE INDEX idx_reactions_message_id             ON public.message_reactions (message_id);

-- ============================================================
-- STEP 5: Enable Realtime
-- Wrapped in DO blocks so a "already in publication" or
-- "FOR ALL TABLES" error doesn't abort the whole script.
-- ============================================================
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;      EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;  EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ============================================================
-- STEP 6: Recreate RPC functions
-- ============================================================

-- authenticate
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

-- get_or_create_conversation
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(
  p_user_id  BIGINT,
  p_other_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_p1 BIGINT := LEAST(p_user_id, p_other_id);
  v_p2 BIGINT := GREATEST(p_user_id, p_other_id);
  v_id BIGINT;
BEGIN
  SELECT id INTO v_id FROM conversations WHERE participant_1 = v_p1 AND participant_2 = v_p2;
  IF v_id IS NULL THEN
    INSERT INTO conversations(participant_1, participant_2) VALUES (v_p1, v_p2) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- send_friend_request
CREATE OR REPLACE FUNCTION public.send_friend_request(
  p_requester_id BIGINT,
  p_addressee_id BIGINT
)
RETURNS TABLE(id BIGINT, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_requester_id = p_addressee_id THEN RAISE EXCEPTION 'SELF_REQUEST'; END IF;
  IF EXISTS (
    SELECT 1 FROM friendships f WHERE
      (f.requester_id = p_requester_id AND f.addressee_id = p_addressee_id) OR
      (f.requester_id = p_addressee_id AND f.addressee_id = p_requester_id)
  ) THEN RAISE EXCEPTION 'ALREADY_EXISTS'; END IF;
  RETURN QUERY
    INSERT INTO friendships(requester_id, addressee_id, status)
    VALUES (p_requester_id, p_addressee_id, 'pending')
    RETURNING friendships.id, friendships.status;
END;
$$;

-- respond_to_request
CREATE OR REPLACE FUNCTION public.respond_to_request(
  p_friendship_id BIGINT,
  p_user_id       BIGINT,
  p_action        TEXT
)
RETURNS TABLE(id BIGINT, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_action NOT IN ('accepted','declined','blocked') THEN RAISE EXCEPTION 'INVALID_ACTION'; END IF;
  RETURN QUERY
    UPDATE friendships SET status = p_action, updated_at = NOW()
    WHERE friendships.id = p_friendship_id AND addressee_id = p_user_id AND friendships.status = 'pending'
    RETURNING friendships.id, friendships.status;
END;
$$;

-- get_conversations
CREATE OR REPLACE FUNCTION public.get_conversations(p_user_id BIGINT)
RETURNS TABLE(
  conversation_id    BIGINT,
  other_user_id      BIGINT,
  other_username     TEXT,
  other_display_name TEXT,
  last_message       TEXT,
  last_message_at    TIMESTAMPTZ,
  unread_count       BIGINT,
  friendship_status  TEXT
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    c.id,
    CASE WHEN c.participant_1 = p_user_id THEN c.participant_2 ELSE c.participant_1 END,
    u.username,
    COALESCE(u.display_name, u.username),
    lm.message,
    lm.created_at,
    (SELECT COUNT(*) FROM messages m
       WHERE m.conversation_id = c.id AND m.sender_id <> p_user_id AND m.read_at IS NULL),
    f.status
  FROM conversations c
  JOIN users u ON u.id = CASE WHEN c.participant_1 = p_user_id THEN c.participant_2 ELSE c.participant_1 END
  LEFT JOIN LATERAL (
    SELECT message, created_at FROM messages
    WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
  ) lm ON TRUE
  LEFT JOIN friendships f ON
    (f.requester_id = p_user_id AND f.addressee_id = u.id) OR
    (f.addressee_id = p_user_id AND f.requester_id = u.id)
  WHERE c.participant_1 = p_user_id OR c.participant_2 = p_user_id
  ORDER BY COALESCE(lm.created_at, c.created_at) DESC;
$$;

-- search_users
CREATE OR REPLACE FUNCTION public.search_users(p_query TEXT, p_current_user_id BIGINT)
RETURNS TABLE(
  id                BIGINT,
  username          TEXT,
  display_name      TEXT,
  friendship_status TEXT,
  friendship_id     BIGINT
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.id, u.username, COALESCE(u.display_name, u.username), f.status, f.id
  FROM users u
  LEFT JOIN friendships f ON
    (f.requester_id = p_current_user_id AND f.addressee_id = u.id) OR
    (f.addressee_id = p_current_user_id AND f.requester_id = u.id)
  WHERE u.id <> p_current_user_id
    AND u.is_active = TRUE
    AND (u.username ILIKE '%' || p_query || '%' OR u.display_name ILIKE '%' || p_query || '%')
  ORDER BY u.display_name
  LIMIT 20;
$$;

-- get_pending_requests
CREATE OR REPLACE FUNCTION public.get_pending_requests(p_user_id BIGINT)
RETURNS TABLE(
  friendship_id BIGINT,
  requester_id  BIGINT,
  username      TEXT,
  display_name  TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id, f.requester_id, u.username, COALESCE(u.display_name, u.username), f.created_at
  FROM friendships f
  JOIN users u ON u.id = f.requester_id
  WHERE f.addressee_id = p_user_id AND f.status = 'pending'
  ORDER BY f.created_at DESC;
$$;

-- get_contacts
CREATE OR REPLACE FUNCTION public.get_contacts(p_user_id BIGINT)
RETURNS TABLE(
  friendship_id BIGINT,
  contact_id    BIGINT,
  username      TEXT,
  display_name  TEXT
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id,
    CASE WHEN f.requester_id = p_user_id THEN f.addressee_id ELSE f.requester_id END,
    u.username, COALESCE(u.display_name, u.username)
  FROM friendships f
  JOIN users u ON u.id = CASE WHEN f.requester_id = p_user_id THEN f.addressee_id ELSE f.requester_id END
  WHERE (f.requester_id = p_user_id OR f.addressee_id = p_user_id) AND f.status = 'accepted'
  ORDER BY u.display_name;
$$;

-- send_dm
CREATE OR REPLACE FUNCTION public.send_dm(
  p_conversation_id BIGINT,
  p_sender_id       BIGINT,
  p_message         TEXT
)
RETURNS TABLE(id BIGINT, conversation_id BIGINT, sender_id BIGINT, message TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE conversations SET last_message_at = NOW() WHERE conversations.id = p_conversation_id;
  RETURN QUERY
    INSERT INTO messages(conversation_id, sender_id, message)
    VALUES (p_conversation_id, p_sender_id, p_message)
    RETURNING messages.id, messages.conversation_id, messages.sender_id, messages.message, messages.created_at;
END;
$$;

-- toggle_reaction
CREATE OR REPLACE FUNCTION public.toggle_reaction(
  p_message_id BIGINT,
  p_user_id    BIGINT,
  p_emoji      TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM message_reactions
    WHERE message_id = p_message_id AND user_id = p_user_id AND emoji = p_emoji
  ) THEN
    DELETE FROM message_reactions
    WHERE message_id = p_message_id AND user_id = p_user_id AND emoji = p_emoji;
    RETURN 'removed';
  ELSE
    INSERT INTO message_reactions(message_id, user_id, emoji)
    VALUES (p_message_id, p_user_id, p_emoji);
    RETURN 'added';
  END IF;
END;
$$;

-- register_user
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
  IF EXISTS (SELECT 1 FROM users WHERE users.username = p_username) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE users.email = p_email) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN';
  END IF;
  RETURN QUERY
    INSERT INTO users (username, display_name, email, password, is_active)
    VALUES (p_username, p_display_name, p_email, p_password, TRUE)
    RETURNING users.id, users.username, users.display_name, users.email, users.is_active, users.created_at;
END;
$$;

-- delete_user_account
CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE users SET is_active = FALSE WHERE users.id = p_user_id;
END;
$$;

-- update_user_profile
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
    RETURNING users.id, users.username, users.display_name, users.email, users.is_active, users.created_at;
END;
$$;

-- ============================================================
-- Done. Database is clean and ready for users.
-- ============================================================
