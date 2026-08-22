-- Attendance details, admin accounts, and approver information.
-- Run after migrations 008-011. Safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Keep these two accounts as the attendance administrators.
INSERT INTO public.users (username, password, display_name, is_active, role)
VALUES ('9506629814', crypt('Admin@1234#', gen_salt('bf', 10)), 'Pradeep', TRUE, 'admin')
ON CONFLICT (username) DO UPDATE
SET password = EXCLUDED.password, display_name = EXCLUDED.display_name,
    is_active = TRUE, role = 'admin';

INSERT INTO public.users (username, password, display_name, is_active, role)
VALUES ('8090272727', crypt('Admin@1234#', gen_salt('bf', 10)), 'Praveen', TRUE, 'admin')
ON CONFLICT (username) DO UPDATE
SET password = EXCLUDED.password, display_name = EXCLUDED.display_name,
    is_active = TRUE, role = 'admin';

-- Remove only other admin accounts. Employee-role accounts are preserved.
DELETE FROM public.users
WHERE role = 'admin' AND username NOT IN ('9506629814', '8090272727');

DROP VIEW IF EXISTS public.attendance_payment_summary;

CREATE VIEW public.attendance_payment_summary AS
SELECT
  ar.id AS attendance_id,
  ar.employee_id,
  ar.attendance_date,
  ar.attendance_type,
  ar.daily_rate,
  CASE WHEN ar.approval_status = 'approved' THEN ar.earned_amount ELSE 0 END::NUMERIC(12,2) AS earned_amount,
  ar.approval_status,
  ar.note,
  ar.approved_by,
  approver.display_name AS approved_by_name,
  CASE WHEN ar.approval_status = 'approved'
    THEN COALESCE(SUM(CASE WHEN ap.status = 'completed' THEN pa.allocated_amount ELSE 0 END), 0)
    ELSE 0
  END::NUMERIC(12,2) AS paid_amount,
  CASE WHEN ar.approval_status = 'approved'
    THEN GREATEST(ar.earned_amount - COALESCE(SUM(CASE WHEN ap.status = 'completed' THEN pa.allocated_amount ELSE 0 END), 0), 0)
    ELSE 0
  END::NUMERIC(12,2) AS outstanding_amount
FROM public.attendance_records ar
LEFT JOIN public.payment_allocations pa ON pa.attendance_id = ar.id
LEFT JOIN public.attendance_payments ap ON ap.id = pa.payment_id
LEFT JOIN public.users approver ON approver.id = ar.approved_by
GROUP BY ar.id, approver.display_name;

GRANT SELECT ON public.attendance_payment_summary TO anon, authenticated;

SELECT id, username, display_name, role, is_active
FROM public.users
WHERE username IN ('9506629814', '8090272727')
ORDER BY username;
