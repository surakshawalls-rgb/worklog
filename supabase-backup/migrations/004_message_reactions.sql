-- ============================================================
-- MIGRATION 004: Message Reactions
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Reactions table
CREATE TABLE IF NOT EXISTS public.message_reactions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  emoji      TEXT   NOT NULL CHECK (char_length(emoji) <= 10),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_reaction UNIQUE (message_id, user_id, emoji)
);

-- 2. Enable REPLICA IDENTITY FULL so DELETE payloads include the old row data
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

-- 3. Disable RLS (custom auth model)
ALTER TABLE public.message_reactions DISABLE ROW LEVEL SECURITY;

-- 4. Grants
GRANT SELECT, INSERT, DELETE ON public.message_reactions TO anon, authenticated;

-- 5. Index
CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON public.message_reactions (message_id);

-- 6. Enable Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 7. toggle_reaction: adds if absent, removes if present
CREATE OR REPLACE FUNCTION public.toggle_reaction(
  p_message_id BIGINT,
  p_user_id    BIGINT,
  p_emoji      TEXT
)
RETURNS TEXT   -- 'added' | 'removed'
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
