-- ============================================================
-- MIGRATION 002: Direct Messaging + Friend System
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Clear old global chat messages
TRUNCATE public.messages;

-- 2. Add conversation_id to messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS conversation_id BIGINT,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- 3. Create conversations table (one row per user-pair)
CREATE TABLE IF NOT EXISTS public.conversations (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_1 BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  participant_2 BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_participants CHECK (participant_1 < participant_2),
  CONSTRAINT uq_conversation UNIQUE (participant_1, participant_2)
);

-- 4. Add FK from messages to conversations
ALTER TABLE public.messages
  ADD CONSTRAINT fk_msg_conversation
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

-- 5. Create friendships table
CREATE TABLE IF NOT EXISTS public.friendships (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  addressee_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | blocked
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_no_self_friend CHECK (requester_id <> addressee_id),
  CONSTRAINT uq_friendship UNIQUE (requester_id, addressee_id)
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_messages_conv_id      ON public.messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_conv_p1               ON public.conversations (participant_1);
CREATE INDEX IF NOT EXISTS idx_conv_p2               ON public.conversations (participant_2);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships (requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships (addressee_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status    ON public.friendships (status);

-- 7. Disable RLS
ALTER TABLE public.users         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships   DISABLE ROW LEVEL SECURITY;

-- 8. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships   TO anon, authenticated;

-- 9. Enable Realtime on new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;

-- ============================================================
-- RPC FUNCTIONS (all SECURITY DEFINER to bypass anon limits)
-- ============================================================

-- Get or create a conversation between two users
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

-- Send a friend request
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

-- Respond to a friend request (accept / decline / block)
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

-- Get all conversations for a user (with last message + unread count)
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

-- Search users (returns friendship status with current user)
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

-- Get incoming pending friend requests
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

-- Get accepted contacts
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

-- Send a message within a conversation (SECURITY DEFINER for anon write)
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
  -- Update last_message_at on the conversation
  UPDATE conversations SET last_message_at = NOW() WHERE conversations.id = p_conversation_id;
  RETURN QUERY
    INSERT INTO messages(conversation_id, sender_id, message)
    VALUES (p_conversation_id, p_sender_id, p_message)
    RETURNING messages.id, messages.conversation_id, messages.sender_id, messages.message, messages.created_at;
END;
$$;
