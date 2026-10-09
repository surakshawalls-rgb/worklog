-- Link employee payments to firm-cash transactions so each payout is recorded
-- once in both ledgers, including payments made before this migration.

ALTER TABLE public.firm_finance_transactions
  ADD COLUMN IF NOT EXISTS attendance_payment_id BIGINT
  REFERENCES public.attendance_payments(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_firm_finance_attendance_payment
  ON public.firm_finance_transactions(attendance_payment_id)
  WHERE attendance_payment_id IS NOT NULL;

INSERT INTO public.firm_finance_transactions (
  transaction_date,
  transaction_type,
  category,
  amount,
  partner_id,
  employee_id,
  reference_id,
  payment_mode,
  description,
  created_at,
  created_by,
  attendance_payment_id
)
SELECT
  ap.payment_date,
  'money_out',
  'Employee payment',
  ap.amount,
  NULL,
  ap.employee_id,
  NULL,
  ap.payment_method,
  'Employee payment #' || ap.id,
  ap.created_at,
  ap.created_by,
  ap.id
FROM public.attendance_payments ap
WHERE ap.status = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM public.firm_finance_transactions fft
    WHERE fft.attendance_payment_id = ap.id
  );

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
  v_balance NUMERIC;
  v_record RECORD;
  v_due NUMERIC(12,2);
  v_allocation NUMERIC(12,2);
BEGIN
  IF v_remaining IS NULL OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID';
  END IF;

  PERFORM 1 FROM public.attendance_employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('firm_finance_balance'));

  SELECT COALESCE(
    SUM(
      CASE
        WHEN transaction_type = 'money_in' THEN amount
        WHEN transaction_type = 'money_out' THEN -amount
        ELSE 0
      END
    ),
    0
  )
  INTO v_balance
  FROM public.firm_finance_transactions;

  IF v_balance < v_remaining THEN
    RAISE EXCEPTION
      'Insufficient firm balance. Available: %, Required: %',
      v_balance,
      v_remaining;
  END IF;

  INSERT INTO public.attendance_payments(
    employee_id,
    amount,
    payment_date,
    payment_method,
    note,
    created_by
  )
  VALUES (
    p_employee_id,
    v_remaining,
    COALESCE(p_payment_date, CURRENT_DATE),
    COALESCE(p_payment_method, 'cash'),
    p_note,
    p_created_by
  )
  RETURNING id INTO v_payment_id;

  FOR v_record IN
    SELECT ar.id, ar.earned_amount,
      COALESCE((
        SELECT SUM(pa.allocated_amount)
        FROM public.payment_allocations pa
        JOIN public.attendance_payments ap ON ap.id = pa.payment_id
        WHERE pa.attendance_id = ar.id AND ap.status = 'completed'
      ), 0) AS paid
    FROM public.attendance_records ar
    WHERE ar.employee_id = p_employee_id AND ar.approval_status = 'approved'
    ORDER BY ar.attendance_date, ar.id
    FOR UPDATE OF ar
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := ROUND(v_record.earned_amount - v_record.paid, 2);
    IF v_due > 0 THEN
      v_allocation := LEAST(v_remaining, v_due);
      INSERT INTO public.payment_allocations(payment_id, attendance_id, allocated_amount)
      VALUES (v_payment_id, v_record.id, v_allocation);
      v_remaining := ROUND(v_remaining - v_allocation, 2);
    END IF;
  END LOOP;

  INSERT INTO public.firm_finance_transactions (
    transaction_date,
    transaction_type,
    category,
    amount,
    partner_id,
    employee_id,
    reference_id,
    payment_mode,
    description,
    created_at,
    created_by,
    attendance_payment_id
  )
  VALUES (
    COALESCE(p_payment_date, CURRENT_DATE),
    'money_out',
    'Employee payment',
    ROUND(p_amount, 2),
    NULL,
    p_employee_id,
    NULL,
    COALESCE(p_payment_method, 'cash'),
    COALESCE(NULLIF(TRIM(p_note), ''), 'Employee wage and advance payment'),
    NOW(),
    p_created_by,
    v_payment_id
  );

  RETURN v_payment_id;
END;
$$;
