-- Daily work-plan banner. Run after migration 016.

CREATE TABLE IF NOT EXISTS public.daily_announcements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message TEXT NOT NULL CHECK (char_length(trim(message)) > 0),
  posted_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_announcements_active
  ON public.daily_announcements (expires_at DESC);

ALTER TABLE public.daily_announcements DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_announcements TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.publish_daily_announcement(
  p_message TEXT,
  p_posted_by BIGINT
)
RETURNS public.daily_announcements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_ist TIMESTAMP;
  v_expires_at TIMESTAMPTZ;
  v_announcement public.daily_announcements;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_posted_by AND role = 'admin' AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Only an active admin can publish the daily plan';
  END IF;

  IF char_length(trim(COALESCE(p_message, ''))) = 0 THEN
    RAISE EXCEPTION 'Announcement message is required';
  END IF;

  v_now_ist := NOW() AT TIME ZONE 'Asia/Kolkata';
  v_expires_at := ((date_trunc('day', v_now_ist) + INTERVAL '20 hours') AT TIME ZONE 'Asia/Kolkata');
  IF v_now_ist >= date_trunc('day', v_now_ist) + INTERVAL '20 hours' THEN
    v_expires_at := v_expires_at + INTERVAL '1 day';
  END IF;

  -- A replacement plan supersedes the earlier one immediately.
  UPDATE public.daily_announcements
  SET expires_at = NOW()
  WHERE expires_at > NOW();

  INSERT INTO public.daily_announcements (message, posted_by, expires_at)
  VALUES (trim(p_message), p_posted_by, v_expires_at)
  RETURNING * INTO v_announcement;

  RETURN v_announcement;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_daily_announcement(TEXT, BIGINT) TO anon, authenticated;
