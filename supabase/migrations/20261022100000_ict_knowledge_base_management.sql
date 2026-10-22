-- ICT Knowledge Base: shared, editable self-service guides.
-- All authenticated staff can read active guides. Only ICT Service Desk
-- operators (ICT team / full ICT module roles) can add, edit or delete them.

create table if not exists public.ict_knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (length(trim(title)) between 3 and 160),
  category text not null default 'Other',
  summary text not null check (length(trim(summary)) between 3 and 400),
  tags text not null default '',
  steps text[] not null default '{}',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ict_knowledge_articles_steps_nonempty check (cardinality(steps) > 0)
);

create index if not exists ict_knowledge_articles_active_category_title_idx
  on public.ict_knowledge_articles (active, category, title);

alter table public.ict_knowledge_articles enable row level security;

drop policy if exists "ict knowledge read active staff" on public.ict_knowledge_articles;
create policy "ict knowledge read active staff" on public.ict_knowledge_articles
  for select to authenticated
  using (public.is_staff(auth.uid()) and active = true);

drop policy if exists "ict knowledge manage ICT operators" on public.ict_knowledge_articles;
create policy "ict knowledge manage ICT operators" on public.ict_knowledge_articles
  for all to authenticated
  using (public.can_work_ict(auth.uid()))
  with check (public.can_work_ict(auth.uid()));

grant select, insert, update, delete on public.ict_knowledge_articles to authenticated;
grant all on public.ict_knowledge_articles to service_role;

-- Seed the existing built-in guides so users keep seeing them after the
-- frontend switches from hard-coded content to the shared database table.
insert into public.ict_knowledge_articles (slug, title, category, summary, tags, steps)
values
('wifi-network', 'Cannot connect to the office network or Wi-Fi', 'Network', 'Troubleshoot a lost or unstable network connection.', 'internet wifi network connection browser', array[
  'Check that Wi-Fi is enabled and airplane mode is off, or reconnect the network cable securely.',
  'Confirm whether other websites or approved applications can connect. If possible, check whether a colleague has the same issue.',
  'Disconnect from the office Wi-Fi and reconnect using the approved network. Do not share the network password with unauthorised people.',
  'Restart your computer if it is safe to do so. Do not reset routers or network equipment yourself.',
  'If the issue continues, raise an ICT ticket and include the error message, location, time it started, and whether other users are affected.'
]),
('printer', 'Printer is not printing', 'Hardware', 'Check printer status, paper, queue and connection before requesting support.', 'printer print paper toner queue scan', array[
  'Check that the printer is powered on and shows no paper, toner, or jam warning.',
  'Confirm that the correct office printer is selected in the print window.',
  'Check whether the printer is paused or showing jobs stuck in the queue. Cancel only your own stuck job if possible.',
  'Check that the computer and printer are connected to the approved office network, where applicable.',
  'If it still fails, raise a ticket with the printer name, your computer, and any displayed error. Do not force paper out or open service panels if you are unsure.'
]),
('email', 'Email is not sending or receiving', 'Software', 'Check connectivity, mailbox status and delivery errors.', 'email outlook mailbox send receive attachment', array[
  'Confirm that your internet connection is working and reopen the approved email application or webmail.',
  'Check the Outbox, Sent Items, Junk/Spam and mailbox storage warning, if shown.',
  'Verify the recipient address and check whether the message includes an attachment that may be too large.',
  'If you receive a delivery failure, keep the error text and note when the issue started.',
  'Raise an ICT ticket if the problem persists. Never send your password or multi-factor authentication code in the ticket.'
]),
('password-access', 'Password, sign-in or account access problem', 'Access/Account', 'Use approved account recovery and report unexpected access prompts.', 'password login sign in account mfa authentication access', array[
  'Check that the username or email address is correct and that Caps Lock is not enabled.',
  'Use only the organisation''s approved password-reset or account-recovery process, if available.',
  'If multi-factor authentication is requested, approve only a sign-in you initiated yourself.',
  'Never share passwords, recovery codes, or one-time verification codes with anyone, including someone claiming to be ICT.',
  'If your account may be compromised or you are unexpectedly locked out, raise an urgent ICT ticket and notify ICT through an approved channel.'
]),
('software-install', 'Need software installed or updated', 'Software', 'Request approved software instead of installing unknown applications yourself.', 'software install update application license admin rights', array[
  'Check whether the software is already available on your computer or through an approved company portal.',
  'Raise an ICT ticket with the software name, business purpose, device name, and deadline.',
  'Include the vendor''s official website or the exact error message if relevant.',
  'Do not bypass administrator controls, use unlicensed software, or download installers from unknown websites.',
  'ICT will confirm compatibility, security and licensing before installation where required.'
]),
('phishing', 'Suspicious email, link or security warning', 'Security', 'Safely report suspected phishing or unusual sign-in activity.', 'phishing scam suspicious email malware security virus link', array[
  'Do not click links, open unexpected attachments, reply, or enter your password on a page opened from the message.',
  'Do not forward the suspicious message to other colleagues. Use the organisation''s approved reporting method if one is available.',
  'Raise an ICT ticket and provide the sender, subject, time received, and a screenshot if safe to capture.',
  'If you already clicked a link, entered credentials, or opened a suspicious file, contact ICT immediately and explain what happened.',
  'Do not delete relevant evidence unless ICT instructs you to do so.'
]),
('slow-computer', 'Computer is slow or frequently freezes', 'Hardware', 'Try safe checks and record the symptoms before escalating.', 'slow computer laptop frozen performance restart', array[
  'Save your work and close applications and browser tabs you are not using.',
  'Check whether the issue affects one application or the whole computer, and note any error messages.',
  'Restart the computer when you have saved your work and no critical task is running.',
  'Do not install cleaner tools, disable security software, or delete business files to free space.',
  'Raise a ticket if the issue continues, including the device name, when it began, and which applications are affected.'
]),
('video-meetings', 'Camera or microphone not working in a meeting', 'Hardware', 'Check device selection, permissions and physical connections.', 'camera microphone headset audio video meeting teams zoom', array[
  'Check that the headset or camera is connected and not physically muted or covered.',
  'In the meeting application''s settings, select the intended microphone, speaker and camera.',
  'Check the operating system''s camera and microphone permissions for the approved meeting application.',
  'Close other applications that may be using the device and rejoin the meeting if appropriate.',
  'If it still fails, raise a ticket with the application name, device model and any error shown.'
])
on conflict (slug) do nothing;
