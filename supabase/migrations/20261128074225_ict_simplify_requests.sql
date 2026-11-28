-- Simplified ICT requests: no per-ticket checklists, a short note on the fix instead.
alter table public.ict_tickets add column if not exists resolution_note text;
-- Disabled, not dropped, so the checklists can be switched back on.
alter table public.ict_tickets disable trigger trg_ict_tickets_seed_controls;
alter table public.ict_tickets disable trigger trg_ict_tickets_reseed_controls;
alter table public.ict_tickets disable trigger trg_guard_ict_ticket_completion;
