
ALTER TABLE public.payments ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_url text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_path text;

CREATE OR REPLACE FUNCTION public.tg_recompute_invoice_payments()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.invoice_id, OLD.invoice_id) IS NOT NULL THEN
    PERFORM public.recompute_invoice(COALESCE(NEW.invoice_id, OLD.invoice_id));
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;

DROP POLICY IF EXISTS "receipts staff read" ON storage.objects;
DROP POLICY IF EXISTS "receipts staff write" ON storage.objects;
DROP POLICY IF EXISTS "receipts staff update" ON storage.objects;
DROP POLICY IF EXISTS "receipts staff delete" ON storage.objects;

CREATE POLICY "receipts staff read" ON storage.objects FOR SELECT
  USING (bucket_id = 'payment-receipts' AND public.is_staff(auth.uid()));
CREATE POLICY "receipts staff write" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'payment-receipts' AND public.is_staff(auth.uid()));
CREATE POLICY "receipts staff update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'payment-receipts' AND public.is_staff(auth.uid()));
CREATE POLICY "receipts staff delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'payment-receipts' AND public.is_staff(auth.uid()));
