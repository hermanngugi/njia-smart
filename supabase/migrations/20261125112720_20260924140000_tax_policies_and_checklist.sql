-- ============================================================================
-- Tax policies + obligation checklist
--
-- Problem: each tax type's cadence/due-day lived hardcoded in three places
-- (tax.tsx, tax.$type.tsx, tax-obligations.tsx) plus a CASE statement in
-- tax_return_due_day()/tax_return_cadence(). None of it was editable, adding
-- a new tax type meant a migration + ALTER TYPE ADD VALUE, and "obligation"
-- was implicit (a pending tax_returns row) with no way to stop the
-- auto-renew loop for a client who de-registers from a tax.
--
-- This migration:
--   1. Turns tax_returns.return_type from a fixed Postgres enum into plain
--      text, foreign-keyed to a new tax_policies table -- so a new tax type
--      is just a row an admin adds on the Policies screen, not a migration.
--   2. Adds an explicit per-client obligation checklist, independent of any
--      single period's filing, which the auto-renew trigger now checks.
-- ============================================================================

-- 1. Policy per tax type: its cadence and filing deadline.
CREATE TABLE IF NOT EXISTS public.tax_policies (
  tax_type    text PRIMARY KEY,
  label       text NOT NULL,
  cadence     text NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('monthly','quarterly','annual')),
  due_day     int  NOT NULL DEFAULT 20 CHECK (due_day BETWEEN 1 AND 31),
  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  updated_by  uuid REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed with the tax types the app already knows about (matches the old
-- tax_return_type enum values), so existing tax_returns rows all resolve.
INSERT INTO public.tax_policies (tax_type, label, cadence, due_day, sort_order) VALUES
  ('vat',         'VAT',              'monthly', 20, 1),
  ('paye',        'PAYE',             'monthly', 9,  2),
  ('wht',         'Withholding Tax',  'monthly', 20, 3),
  ('rental',      'Rental Income',    'monthly', 20, 4),
  ('tot',         'Turnover Tax',     'monthly', 20, 5),
  ('nssf',        'NSSF',             'monthly', 9,  6),
  ('sha',         'SHA',              'monthly', 9,  7),
  ('nita',        'NITA',             'monthly', 9,  8),
  ('etims',       'eTIMS',            'monthly', 20, 9),
  ('excise_duty', 'Excise Duty',      'monthly', 20, 10),
  ('mri',         'MRI',              'monthly', 20, 11),
  ('nil',         'Nil Return',       'monthly', 30, 12),
  ('corp_tax',    'Corporation Tax',  'annual',  30, 13),
  ('income_tax',  'Income Tax',       'annual',  30, 14)
ON CONFLICT (tax_type) DO NOTHING;

GRANT SELECT ON public.tax_policies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tax_policies TO authenticated;
GRANT ALL ON public.tax_policies TO service_role;
ALTER TABLE public.tax_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax policies read staff" ON public.tax_policies FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "tax policies insert admin" ON public.tax_policies FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "tax policies update admin" ON public.tax_policies FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "tax policies delete admin" ON public.tax_policies FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- 2. Convert tax_returns.return_type from the fixed enum to text, FK'd to
--    the policy table. (The old public.tax_return_type enum is left in
--    place, just unused, in case anything external still references it.)
ALTER TABLE public.tax_returns ALTER COLUMN return_type TYPE text USING return_type::text;
ALTER TABLE public.tax_returns
  ADD CONSTRAINT tax_returns_return_type_fkey FOREIGN KEY (return_type)
  REFERENCES public.tax_policies(tax_type);

-- Lookups now read the policy table directly (no more hardcoded CASE
-- fallback -- if a type has no policy row, something upstream is broken).
CREATE OR REPLACE FUNCTION public.tax_return_due_day(_type text)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT due_day FROM public.tax_policies WHERE tax_type = _type), 20);
$$;

CREATE OR REPLACE FUNCTION public.tax_return_cadence(_type text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT cadence FROM public.tax_policies WHERE tax_type = _type), 'monthly');
$$;

-- next_tax_due_date() now transitively reads a table via the two functions
-- above, so it can no longer be IMMUTABLE -- redeclare as STABLE. Also
-- handles the 'quarterly' cadence, which is now selectable in Policies.
CREATE OR REPLACE FUNCTION public.next_tax_due_date(_type text, _cur_due date)
RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_cadence text := public.tax_return_cadence(_type);
  v_day int := public.tax_return_due_day(_type);
  v_base date := COALESCE(_cur_due, CURRENT_DATE);
  v_year int;
  v_month int;
BEGIN
  IF v_cadence = 'annual' THEN
    v_year := EXTRACT(YEAR FROM v_base)::int + 1;
    v_month := EXTRACT(MONTH FROM v_base)::int;
  ELSIF v_cadence = 'quarterly' THEN
    v_year := EXTRACT(YEAR FROM v_base)::int;
    v_month := EXTRACT(MONTH FROM v_base)::int + 3;
    IF v_month > 12 THEN v_month := v_month - 12; v_year := v_year + 1; END IF;
  ELSE
    v_year := EXTRACT(YEAR FROM v_base)::int;
    v_month := EXTRACT(MONTH FROM v_base)::int + 1;
    IF v_month > 12 THEN
      v_month := 1;
      v_year := v_year + 1;
    END IF;
  END IF;

  RETURN make_date(v_year, v_month, v_day);
EXCEPTION WHEN others THEN
  -- day doesn't exist in that month (e.g. day 30 in Feb) -> clamp to month end
  RETURN (make_date(v_year, v_month, 1) + INTERVAL '1 month - 1 day')::date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tax_return_due_day(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_return_cadence(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_tax_due_date(text, date) TO authenticated;

-- 3. Checklist: which tax types a client is currently obligated for, kept
--    separate from any single period's filing so it can be switched off.
CREATE TABLE IF NOT EXISTS public.client_tax_obligations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tax_type    text NOT NULL REFERENCES public.tax_policies(tax_type),
  active      boolean NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, tax_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_tax_obligations TO authenticated;
GRANT ALL ON public.client_tax_obligations TO service_role;
ALTER TABLE public.client_tax_obligations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client tax obligations staff all" ON public.client_tax_obligations FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Backfill the checklist from tax_returns rows that already exist.
INSERT INTO public.client_tax_obligations (client_id, tax_type, active)
SELECT DISTINCT client_id, return_type, true FROM public.tax_returns
ON CONFLICT (client_id, tax_type) DO NOTHING;

-- Scheduling a return for a client/type (however it happens) marks that
-- obligation active again -- e.g. a client resumes a tax they'd paused.
CREATE OR REPLACE FUNCTION public.tg_sync_tax_obligation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.client_tax_obligations (client_id, tax_type, active)
  VALUES (NEW.client_id, NEW.return_type, true)
  ON CONFLICT (client_id, tax_type) DO UPDATE SET active = true, updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_tax_obligation ON public.tax_returns;
CREATE TRIGGER trg_sync_tax_obligation
AFTER INSERT ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_tax_obligation();

-- 4. Auto-renew now checks the checklist first: filing the current period
--    only schedules the next one while the obligation is still active.
CREATE OR REPLACE FUNCTION public.tg_tax_return_filed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next_due date;
  v_next_start date;
  v_next_end date;
  v_span int;
  v_new_id uuid;
  v_obligation_active boolean;
BEGIN
  IF NEW.status = 'filed' AND (OLD.status IS DISTINCT FROM 'filed') THEN
    NEW.filed_at := now();

    IF NEW.renewed_to_id IS NULL THEN
      SELECT active INTO v_obligation_active
        FROM public.client_tax_obligations
        WHERE client_id = NEW.client_id AND tax_type = NEW.return_type;

      IF COALESCE(v_obligation_active, true) THEN
        v_next_due := public.next_tax_due_date(NEW.return_type, NEW.due_date);

        IF NEW.period_start IS NOT NULL AND NEW.period_end IS NOT NULL THEN
          v_span := (NEW.period_end - NEW.period_start);
          v_next_start := NEW.period_end + 1;
          v_next_end := v_next_start + v_span;
        ELSE
          v_next_start := NULL;
          v_next_end := NULL;
        END IF;

        INSERT INTO public.tax_returns
          (client_id, return_type, period_start, period_end, due_date, status, assigned_to)
        VALUES
          (NEW.client_id, NEW.return_type, v_next_start, v_next_end, v_next_due, 'pending', NEW.assigned_to)
        RETURNING id INTO v_new_id;

        NEW.renewed_to_id := v_new_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
-- trg_tax_return_filed already exists (BEFORE UPDATE on tax_returns) from an
-- earlier migration and picks up this new function body automatically.

-- 5. One RPC the UI calls to flip a checklist box: turning an obligation on
--    creates its first open period (if none is already pending); turning it
--    off just stops future auto-renewal -- existing open periods untouched.
CREATE OR REPLACE FUNCTION public.set_client_tax_obligation(_client_id uuid, _tax_type text, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_exists boolean;
  v_due date;
BEGIN
  INSERT INTO public.client_tax_obligations (client_id, tax_type, active)
  VALUES (_client_id, _tax_type, _active)
  ON CONFLICT (client_id, tax_type) DO UPDATE SET active = _active, updated_at = now();

  IF _active THEN
    SELECT EXISTS(
      SELECT 1 FROM public.tax_returns
      WHERE client_id = _client_id AND return_type = _tax_type AND status != 'filed'
    ) INTO v_exists;

    IF NOT v_exists THEN
      v_due := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int, public.tax_return_due_day(_tax_type));
      IF v_due < CURRENT_DATE THEN
        v_due := public.next_tax_due_date(_tax_type, v_due);
      END IF;
      INSERT INTO public.tax_returns (client_id, return_type, due_date, status)
      VALUES (_client_id, _tax_type, v_due, 'pending');
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_client_tax_obligation(uuid, text, boolean) TO authenticated;
