-- Add custom attendance wages while preserving the historical earned_amount value.
-- Run after migrations 008-013.

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_attendance_type_check;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_attendance_type_check
  CHECK (attendance_type IN ('full_day', 'half_day', 'leave', 'custom'));

-- Keep the summary view's existing columns and financial rules.
SELECT attendance_id, attendance_type, earned_amount, approval_status
FROM public.attendance_payment_summary
ORDER BY attendance_date, attendance_id;
