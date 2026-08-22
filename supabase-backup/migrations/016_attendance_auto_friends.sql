-- Make attendance-app users immediate communication contacts.
-- Run after migration 015. Safe to run repeatedly.

INSERT INTO public.friendships (requester_id, addressee_id, status)
SELECT LEAST(a.user_id, b.user_id), GREATEST(a.user_id, b.user_id), 'accepted'
FROM public.attendance_employees a
JOIN public.attendance_employees b ON a.id < b.id
WHERE a.user_id IS NOT NULL AND b.user_id IS NOT NULL
ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'accepted', updated_at = NOW();

CREATE OR REPLACE FUNCTION public.auto_accept_attendance_friendship()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    INSERT INTO public.friendships (requester_id, addressee_id, status)
    SELECT LEAST(NEW.user_id, other.user_id), GREATEST(NEW.user_id, other.user_id), 'accepted'
    FROM public.attendance_employees other
    WHERE other.id <> NEW.id AND other.user_id IS NOT NULL
    ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'accepted', updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_accept_attendance_friendship ON public.attendance_employees;
CREATE TRIGGER trg_auto_accept_attendance_friendship
AFTER INSERT OR UPDATE OF user_id ON public.attendance_employees
FOR EACH ROW EXECUTE FUNCTION public.auto_accept_attendance_friendship();

GRANT EXECUTE ON FUNCTION public.auto_accept_attendance_friendship() TO anon, authenticated;
