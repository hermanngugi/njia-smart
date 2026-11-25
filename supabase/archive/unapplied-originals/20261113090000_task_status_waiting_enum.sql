-- Tasks: new status "Waiting on client" (work is blocked on the client, not on us).
-- Enum values must be added in their own migration, before anything uses them
-- (same pattern as 20260924120000_tax_enum_extend.sql).
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'waiting_on_client';
