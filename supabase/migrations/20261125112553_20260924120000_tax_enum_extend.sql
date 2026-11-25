-- The tax page UI already offers these return types (see src/routes/_authed/tax.tsx)
-- but they were never added to the enum, so scheduling one would fail. Add them.
ALTER TYPE public.tax_return_type ADD VALUE IF NOT EXISTS 'etims';
ALTER TYPE public.tax_return_type ADD VALUE IF NOT EXISTS 'income_tax';
ALTER TYPE public.tax_return_type ADD VALUE IF NOT EXISTS 'nita';
ALTER TYPE public.tax_return_type ADD VALUE IF NOT EXISTS 'excise_duty';
