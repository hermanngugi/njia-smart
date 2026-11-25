-- Fix schema drift: invoice service_line is a general billing label, not a
-- service_module_type. That enum intentionally contains only the four module
-- keys (ict, outsourced_accounting, payroll_management,
-- financial_business_management), while invoices also support Audit, Tax,
-- Advisory, Accounting, Bookkeeping, and other billing categories.
--
-- Convert the column to TEXT so both module and non-module invoice categories
-- are valid. Preserve existing values, then normalize the four module keys to
-- the display labels used by the application and billing filters.

ALTER TABLE public.invoices
  ALTER COLUMN service_line TYPE text
  USING service_line::text;

UPDATE public.invoices
SET service_line = CASE service_line
  WHEN 'ict' THEN 'ICT'
  WHEN 'outsourced_accounting' THEN 'Outsourced Accounting'
  WHEN 'payroll_management' THEN 'Payroll Management'
  WHEN 'financial_business_management' THEN 'Financial Business Management'
  ELSE service_line
END
WHERE service_line IN (
  'ict',
  'outsourced_accounting',
  'payroll_management',
  'financial_business_management'
);
