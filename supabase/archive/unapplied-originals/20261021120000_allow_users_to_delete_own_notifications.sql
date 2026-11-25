-- Let authenticated users clear only their own notification records.
-- This supports the Clear action in the notification bell without granting
-- access to other users' notifications.
drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own"
  on public.notifications
  for delete
  to authenticated
  using (user_id = auth.uid());
