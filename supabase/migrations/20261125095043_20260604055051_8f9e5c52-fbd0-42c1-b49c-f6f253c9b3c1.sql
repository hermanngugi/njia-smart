ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'company' CHECK (client_type IN ('company','individual'));
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS id_number TEXT;