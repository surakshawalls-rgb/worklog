-- Fix write access for the custom-auth MVP.
-- The app uses public.users login rather than Supabase Auth, so these tables
-- must not require an auth.uid() policy.

ALTER TABLE public.attendance_employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_employees TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance_records TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance_payments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_allocations TO anon, authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

SELECT relname AS table_name, relrowsecurity AS row_level_security_enabled
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('attendance_employees', 'attendance_records', 'attendance_payments', 'payment_allocations')
ORDER BY relname;
