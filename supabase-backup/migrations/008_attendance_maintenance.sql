-- Attendance & Wage Tracker shared schema for Sync Point's Supabase project.
-- Apply after the existing Sync Point migrations.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee';

DO $$ BEGIN
  ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('employee', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Preserve the existing Sync Point seed administrator as the first attendance admin.
UPDATE public.users SET role = 'admin' WHERE username = 'pradeep' AND role = 'employee';

-- Temporary MVP admin account requested for initial testing.
-- Replace this password before production use.
INSERT INTO public.users (username, password, display_name, is_active, role)
VALUES ('9506629814', '9506629814', 'Attendance Admin', TRUE, 'admin')
ON CONFLICT (username) DO UPDATE
SET display_name = EXCLUDED.display_name,
    is_active = TRUE,
    role = 'admin';

CREATE TABLE IF NOT EXISTS public.attendance_employees (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT UNIQUE REFERENCES public.users(id) ON DELETE SET NULL,
  employee_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  mobile TEXT,
  default_daily_rate NUMERIC(12,2) NOT NULL CHECK (default_daily_rate >= 0),
  joining_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES public.attendance_employees(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  attendance_type TEXT NOT NULL CHECK (attendance_type IN ('full_day', 'half_day', 'leave', 'custom')),
  daily_rate NUMERIC(12,2) NOT NULL CHECK (daily_rate >= 0),
  earned_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (earned_amount >= 0),
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'denied')),
  note TEXT,
  submitted_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS public.attendance_payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES public.attendance_employees(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank_transfer', 'upi', 'other')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'reversed')),
  created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  reversed_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES public.attendance_payments(id) ON DELETE RESTRICT,
  attendance_id BIGINT NOT NULL REFERENCES public.attendance_records(id) ON DELETE RESTRICT,
  allocated_amount NUMERIC(12,2) NOT NULL CHECK (allocated_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, attendance_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_date
  ON public.attendance_records (employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_pending
  ON public.attendance_records (approval_status) WHERE approval_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_attendance_payments_employee_date
  ON public.attendance_payments (employee_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_attendance
  ON public.payment_allocations (attendance_id);

ALTER TABLE public.attendance_employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_employees TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance_records TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance_payments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_allocations TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

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
  v_outstanding NUMERIC(12,2);
  v_record RECORD;
  v_due NUMERIC(12,2);
  v_allocation NUMERIC(12,2);
BEGIN
  IF v_remaining IS NULL OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID';
  END IF;

  PERFORM 1 FROM attendance_employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;

  SELECT COALESCE(SUM(ar.earned_amount), 0) - COALESCE((
    SELECT SUM(pa.allocated_amount)
    FROM payment_allocations pa
    JOIN attendance_payments ap ON ap.id = pa.payment_id
    WHERE ap.employee_id = p_employee_id AND ap.status = 'completed'
  ), 0)
  INTO v_outstanding
  FROM attendance_records ar
  WHERE ar.employee_id = p_employee_id AND ar.approval_status = 'approved';

  v_outstanding := ROUND(GREATEST(v_outstanding, 0), 2);
  IF v_remaining > v_outstanding THEN RAISE EXCEPTION 'PAYMENT_EXCEEDS_OUTSTANDING'; END IF;

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

CREATE OR REPLACE FUNCTION public.reverse_attendance_payment(p_payment_id BIGINT, p_reversed_by BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE attendance_payments
  SET status = 'reversed', reversed_at = NOW(), reversed_by = p_reversed_by
  WHERE id = p_payment_id AND status = 'completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND_OR_ALREADY_REVERSED'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_attendance_payment(BIGINT, NUMERIC, DATE, TEXT, TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_attendance_payment(BIGINT, BIGINT) TO anon, authenticated;

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
FROM attendance_records ar
LEFT JOIN payment_allocations pa ON pa.attendance_id = ar.id
LEFT JOIN attendance_payments ap ON ap.id = pa.payment_id
GROUP BY ar.id;
GRANT SELECT ON public.attendance_payment_summary TO anon, authenticated;
