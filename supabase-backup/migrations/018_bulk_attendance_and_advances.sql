-- Bulk attendance, historical payment reconciliation, and wage advances.
-- Run after migration 017.

CREATE OR REPLACE FUNCTION public.reconcile_attendance_employee(p_employee_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record RECORD;
  v_payment RECORD;
  v_due NUMERIC(12,2);
  v_available NUMERIC(12,2);
  v_allocation NUMERIC(12,2);
BEGIN
  -- Rebuild FIFO allocations so an earlier advance automatically covers later approved work.
  DELETE FROM public.payment_allocations pa
  USING public.attendance_payments ap
  WHERE pa.payment_id = ap.id AND ap.employee_id = p_employee_id;

  FOR v_record IN
    SELECT id, earned_amount
    FROM public.attendance_records
    WHERE employee_id = p_employee_id AND approval_status = 'approved'
    ORDER BY attendance_date, id
  LOOP
    v_due := ROUND(v_record.earned_amount, 2);
    FOR v_payment IN
      SELECT id, amount
      FROM public.attendance_payments
      WHERE employee_id = p_employee_id AND status = 'completed'
      ORDER BY payment_date, id
    LOOP
      EXIT WHEN v_due <= 0;
      SELECT ROUND(v_payment.amount - COALESCE(SUM(allocated_amount), 0), 2)
      INTO v_available
      FROM public.payment_allocations
      WHERE payment_id = v_payment.id;
      IF v_available > 0 THEN
        v_allocation := LEAST(v_due, v_available);
        INSERT INTO public.payment_allocations(payment_id, attendance_id, allocated_amount)
        VALUES (v_payment.id, v_record.id, v_allocation);
        v_due := ROUND(v_due - v_allocation, 2);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_attendance_payment(
  p_employee_id BIGINT,
  p_amount NUMERIC,
  p_payment_date DATE,
  p_payment_method TEXT,
  p_note TEXT,
  p_created_by BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID'; END IF;
  PERFORM 1 FROM public.attendance_employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;

  INSERT INTO public.attendance_payments(employee_id, amount, payment_date, payment_method, note, created_by)
  VALUES (p_employee_id, ROUND(p_amount, 2), COALESCE(p_payment_date, CURRENT_DATE), COALESCE(p_payment_method, 'cash'), p_note, p_created_by)
  RETURNING id INTO v_payment_id;

  PERFORM public.reconcile_attendance_employee(p_employee_id);
  RETURN v_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_attendance_payment(p_payment_id BIGINT, p_reversed_by BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_employee_id BIGINT;
BEGIN
  UPDATE public.attendance_payments
  SET status = 'reversed', reversed_at = NOW(), reversed_by = p_reversed_by
  WHERE id = p_payment_id AND status = 'completed'
  RETURNING employee_id INTO v_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND_OR_ALREADY_REVERSED'; END IF;
  PERFORM public.reconcile_attendance_employee(v_employee_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_attendance_approval(
  p_attendance_id BIGINT,
  p_status TEXT,
  p_admin_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_employee_id BIGINT;
BEGIN
  IF p_status NOT IN ('approved', 'denied') THEN RAISE EXCEPTION 'INVALID_APPROVAL_STATUS'; END IF;
  UPDATE public.attendance_records
  SET approval_status = p_status, approved_by = p_admin_id, approved_at = NOW()
  WHERE id = p_attendance_id AND approval_status = 'pending'
  RETURNING employee_id INTO v_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTENDANCE_NOT_PENDING'; END IF;
  PERFORM public.reconcile_attendance_employee(v_employee_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_bulk_attendance(
  p_employee_ids BIGINT[],
  p_attendance_date DATE,
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
DECLARE v_count INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_submitted_by AND role = 'admin' AND is_active = TRUE) THEN
    RAISE EXCEPTION 'Only an active admin can bulk mark attendance';
  END IF;
  IF COALESCE(array_length(p_employee_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Select at least one employee'; END IF;
  IF p_attendance_type NOT IN ('full_day', 'half_day', 'leave', 'custom') THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_TYPE'; END IF;
  IF p_attendance_type = 'custom' AND COALESCE(p_custom_wage, 0) <= 0 THEN RAISE EXCEPTION 'CUSTOM_WAGE_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_records WHERE employee_id = ANY(p_employee_ids) AND attendance_date = p_attendance_date) THEN
    RAISE EXCEPTION 'BULK_ATTENDANCE_ALREADY_EXISTS';
  END IF;

  INSERT INTO public.attendance_records(employee_id, attendance_date, attendance_type, daily_rate, earned_amount, note, submitted_by)
  SELECT employee.id, p_attendance_date, p_attendance_type, employee.default_daily_rate,
    CASE p_attendance_type WHEN 'full_day' THEN employee.default_daily_rate WHEN 'half_day' THEN employee.default_daily_rate / 2 WHEN 'custom' THEN p_custom_wage ELSE 0 END,
    NULLIF(trim(COALESCE(p_note, '')), ''), p_submitted_by
  FROM public.attendance_employees employee
  WHERE employee.id = ANY(p_employee_ids) AND employee.status = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> array_length(p_employee_ids, 1) THEN RAISE EXCEPTION 'One or more selected employees are inactive or unavailable'; END IF;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_attendance_employee(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_attendance_payment(BIGINT, NUMERIC, DATE, TEXT, TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_attendance_payment(BIGINT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_attendance_approval(BIGINT, TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_bulk_attendance(BIGINT[], DATE, TEXT, TEXT, NUMERIC, BIGINT) TO anon, authenticated;
