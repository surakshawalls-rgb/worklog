-- Denied attendance must never create earnings or outstanding balance.
-- Run this after migration 008 to repair the live summary view.

CREATE OR REPLACE VIEW public.attendance_payment_summary AS
SELECT
  ar.id AS attendance_id,
  ar.employee_id,
  ar.attendance_date,
  ar.attendance_type,
  ar.daily_rate,
  CASE WHEN ar.approval_status = 'approved' THEN ar.earned_amount ELSE 0 END AS earned_amount,
  ar.approval_status,
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
GROUP BY ar.id;

GRANT SELECT ON public.attendance_payment_summary TO anon, authenticated;

SELECT attendance_id, approval_status, earned_amount, paid_amount, outstanding_amount
FROM public.attendance_payment_summary
ORDER BY attendance_id;