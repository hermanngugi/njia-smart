-- Fix: client-linked chat channels were gated on client_assignments, which
-- is stricter than every other client-scoped module (documents,
-- engagements, tax_returns) — those use can_access_financials() so any
-- non-marketing staff member can work with any client. Chat should follow
-- the same rule, or staff browsing a client they aren't in
-- client_assignments for get "new row violates row-level security policy"
-- the moment they try to open/create that client's channel.

create or replace function public.can_access_chat_channel(_channel_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_channels c
    where c.id = _channel_id
      and (
        (c.kind = 'team' and public.is_staff(_user_id))
        or (c.kind = 'client' and c.client_id is not null and public.can_access_financials(_user_id))
        or (
          c.kind in ('dm', 'group') and exists (
            select 1 from public.chat_channel_members m
            where m.channel_id = c.id and m.user_id = _user_id
          )
        )
      )
  )
$$;

alter policy "chat channels insert staff" on public.chat_channels
  with check (
    public.is_staff(auth.uid()) and created_by = auth.uid()
    and (
      kind = 'team'
      or (kind = 'client' and public.can_access_financials(auth.uid()))
      or kind in ('dm', 'group')
    )
  );
