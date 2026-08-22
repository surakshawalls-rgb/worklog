-- ============================================================
-- MIGRATION 007: Device Tokens for Push Notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token       TEXT   NOT NULL,
  platform    TEXT   NOT NULL DEFAULT 'android',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_device_token UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON public.device_tokens (user_id);

-- RLS off (consistent with rest of app)
ALTER TABLE public.device_tokens DISABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO anon, authenticated;

-- RPC: upsert a device token for a user
CREATE OR REPLACE FUNCTION public.register_device_token(
  p_user_id  BIGINT,
  p_token    TEXT,
  p_platform TEXT DEFAULT 'android'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO device_tokens (user_id, token, platform, updated_at)
  VALUES (p_user_id, p_token, p_platform, NOW())
  ON CONFLICT (user_id, token)
  DO UPDATE SET updated_at = NOW(), platform = EXCLUDED.platform;
END;
$$;

-- RPC: remove a device token on logout
CREATE OR REPLACE FUNCTION public.remove_device_token(
  p_user_id BIGINT,
  p_token   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM device_tokens WHERE user_id = p_user_id AND token = p_token;
END;
$$;
