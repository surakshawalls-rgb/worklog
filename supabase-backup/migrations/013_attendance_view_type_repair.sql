-- Repair the attendance summary view when migration 012 failed with 42P16.
-- Run this once in Supabase SQL Editor.

DROP VIEW IF EXISTS public.attendance_payment_summary;

CREATE VIEW public.attendance_payment_summary AS
SELECT
  ar.id AS attendance_id,
  ar.employee_id,
  ar.attendance_date,
  ar.attendance_type,
  ar.daily_rate::NUMERIC(12,2) AS daily_rate,
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

SELECT attendance_id, approval_status, note, approved_by_name, earned_amount, paid_amount, outstanding_amount
FROM public.attendance_payment_summary
ORDER BY attendance_id;