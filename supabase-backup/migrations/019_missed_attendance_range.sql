-- Missed-attendance date ranges for employees and admins.
-- Run after migration 018.

CREATE OR REPLACE FUNCTION public.submit_attendance_range(
  p_employee_ids BIGINT[],
  p_start_date DATE,
  p_end_date DATE,
  p_attendance_type TEXT,
  p_note TEXT,
  p_custom_wage NUMERIC,
  p_submitted_by BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_day DATE;
  v_count INTEGER := 0;
BEGIN
  SELECT role = 'admin' AND is_active INTO v_is_admin FROM public.users WHERE id = p_submitted_by;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBMITTER_NOT_FOUND'; END IF;
  IF COALESCE(array_length(p_employee_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Select at least one employee'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  IF p_end_date > CURRENT_DATE THEN RAISE EXCEPTION 'Future attendance cannot be submitted'; END IF;
  IF p_end_date - p_start_date > 31 THEN RAISE EXCEPTION 'Date range cannot exceed 31 days'; END IF;
  IF p_attendance_type NOT IN ('full_day', 'half_day', 'leave', 'custom') THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_TYPE'; END IF;
  IF p_attendance_type = 'custom' AND COALESCE(p_custom_wage, 0) <= 0 THEN RAISE EXCEPTION 'CUSTOM_WAGE_REQUIRED'; END IF;

  IF NOT v_is_admin AND EXISTS (
    SELECT 1 FROM public.attendance_employees
    WHERE id = ANY(p_employee_ids) AND user_id <> p_submitted_by
  ) THEN RAISE EXCEPTION 'Employees can submit attendance only for themselves'; END IF;

  IF EXISTS (SELECT 1 FROM public.attendance_employees WHERE id = ANY(p_employee_ids) AND status <> 'active') THEN
    RAISE EXCEPTION 'One or more selected employees are inactive';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.attendance_records
    WHERE employee_id = ANY(p_employee_ids)
      AND attendance_date BETWEEN p_start_date AND p_end_date
  ) THEN RAISE EXCEPTION 'ATTENDANCE_ALREADY_EXISTS_IN_RANGE'; END IF;

  FOR v_day IN SELECT generate_series(p_start_date, p_end_date, INTERVAL '1 day')::DATE LOOP
    INSERT INTO public.attendance_records(employee_id, attendance_date, attendance_type, daily_rate, earned_amount, note, submitted_by)
    SELECT employee.id, v_day, p_attendance_type, employee.default_daily_rate,
      CASE p_attendance_type WHEN 'full_day' THEN employee.default_daily_rate WHEN 'half_day' THEN employee.default_daily_rate / 2 WHEN 'custom' THEN p_custom_wage ELSE 0 END,
      NULLIF(trim(COALESCE(p_note, '')), ''), p_submitted_by
    FROM public.attendance_employees employee
    WHERE employee.id = ANY(p_employee_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_attendance_range(BIGINT[], DATE, DATE, TEXT, TEXT, NUMERIC, BIGINT) TO anon, authenticated;
