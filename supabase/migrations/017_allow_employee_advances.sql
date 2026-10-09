-- Allow employee payments to exceed current wages owed.
-- Any amount beyond FIFO wage allocations remains an employee advance in the
-- payment ledger and is included in the employee's paid balance.

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
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_payment_id BIGINT;
  v_remaining NUMERIC(12,2) := ROUND(p_amount, 2);
  v_record RECORD;
  v_due NUMERIC(12,2);
  v_allocation NUMERIC(12,2);
BEGIN
  IF v_remaining IS NULL OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID';
  END IF;

  PERFORM 1 FROM attendance_employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;

  INSERT INTO attendance_payments(employee_id, amount, payment_date, payment_method, note, created_by)
  VALUES (p_employee_id, v_remaining, COALESCE(p_payment_date, CURRENT_DATE), COALESCE(p_payment_method, 'cash'), p_note, p_created_by)
  RETURNING id INTO v_payment_id;

  FOR v_record IN
    SELECT ar.id, ar.earned_amount,
      COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa
        JOIN attendance_payments ap ON ap.id = pa.payment_id
        WHERE pa.attendance_id = ar.id AND ap.status = 'completed'), 0) AS paid
    FROM attendance_records ar
    WHERE ar.employee_id = p_employee_id AND ar.approval_status = 'approved'
    ORDER BY ar.attendance_date, ar.id
    FOR UPDATE OF ar
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := ROUND(v_record.earned_amount - v_record.paid, 2);
    IF v_due > 0 THEN
      v_allocation := LEAST(v_remaining, v_due);
      INSERT INTO payment_allocations(payment_id, attendance_id, allocated_amount)
      VALUES (v_payment_id, v_record.id, v_allocation);
      v_remaining := ROUND(v_remaining - v_allocation, 2);
    END IF;
  END LOOP;

  RETURN v_payment_id;
END;
$$;
