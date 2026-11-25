-- ============================================================================
-- ICT Tickets — allow deletion (Director/Admin only)
--
-- 20260926060000_ict_tickets.sql intentionally shipped with no delete policy,
-- so deletes were blocked for everyone at the RLS level. This adds one,
-- restricted the same way ticket updates and asset management already are:
-- only "full" rank on 'ict_service_desk' (Director/Admin today) may delete.
-- ============================================================================

drop policy if exists "ict tickets delete full module only" on public.ict_tickets;
create policy "ict tickets delete full module only" on public.ict_tickets
  for delete to authenticated
  using (public.has_full_module(auth.uid(), 'ict_service_desk'));

grant delete on public.ict_tickets to authenticated;
