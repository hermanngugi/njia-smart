-- Njia Smart repair 10: ICT knowledge base and password-vault controls.
CREATE TABLE IF NOT EXISTS public.ict_knowledge_articles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text NOT NULL UNIQUE,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 160),
 category text NOT NULL DEFAULT 'Other',
 summary text NOT NULL CHECK(length(trim(summary)) BETWEEN 3 AND 400),
 tags text NOT NULL DEFAULT '',steps text[] NOT NULL DEFAULT '{}',
 active boolean NOT NULL DEFAULT true,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT ict_knowledge_articles_steps_nonempty CHECK(cardinality(steps)>0)
);
CREATE INDEX IF NOT EXISTS ict_knowledge_articles_active_category_title_idx ON public.ict_knowledge_articles(active,category,title);
ALTER TABLE public.ict_knowledge_articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ict knowledge read active staff" ON public.ict_knowledge_articles;
CREATE POLICY "ict knowledge read active staff" ON public.ict_knowledge_articles FOR SELECT TO authenticated USING(public.is_staff(auth.uid()) AND active);
DROP POLICY IF EXISTS "ict knowledge manage ICT operators" ON public.ict_knowledge_articles;
CREATE POLICY "ict knowledge manage ICT operators" ON public.ict_knowledge_articles FOR ALL TO authenticated
USING(public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='ict_officer'))
WITH CHECK((public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='ict_officer'))
 AND (created_by IS NULL OR created_by=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ict_knowledge_articles TO authenticated;
GRANT ALL ON public.ict_knowledge_articles TO service_role;

INSERT INTO public.ict_knowledge_articles(slug,title,category,summary,tags,steps) VALUES
('wifi-network','Cannot connect to office network or Wi-Fi','Network','Troubleshoot a lost or unstable network connection.','internet wifi network',ARRAY['Check Wi-Fi is enabled or reconnect the network cable.','Confirm whether colleagues have the same issue.','Reconnect using the approved office network.','Restart your computer if safe.','Raise an ICT ticket with the error and time it started.']),
('printer','Printer is not printing','Hardware','Check printer status, paper, queue and connection.','printer paper toner queue',ARRAY['Check power, paper, toner and jam indicators.','Confirm the correct printer is selected.','Check whether your job is stuck in the queue.','Confirm the approved network connection.','Raise a ticket with printer name and error.']),
('email','Email is not sending or receiving','Software','Check connectivity, mailbox status and delivery errors.','email outlook mailbox',ARRAY['Confirm internet connection and reopen approved mail app.','Check Outbox, Junk and mailbox storage.','Verify recipient and attachment size.','Keep any delivery failure message.','Raise a ticket if unresolved.']),
('password-access','Password or account access problem','Access/Account','Use approved account recovery and report unexpected prompts.','password login account mfa',ARRAY['Check username and Caps Lock.','Use only approved password reset.','Approve only sign-ins you initiated.','Never share passwords or one-time codes.','Report suspected compromise immediately.']),
('software-install','Need software installed or updated','Software','Request approved software rather than installing unknown applications.','software install update licence',ARRAY['Check approved software catalogue.','Raise a ticket with purpose and device.','Provide the vendor official website if relevant.','Do not bypass administrator controls.','ICT confirms compatibility and licensing.']),
('phishing','Suspicious email, link or security warning','Security','Safely report suspected phishing or unusual sign-in activity.','phishing scam suspicious email',ARRAY['Do not click links or open unexpected attachments.','Use approved reporting method.','Provide sender, subject and time to ICT.','If credentials were entered, contact ICT immediately.','Preserve evidence unless instructed otherwise.'])
ON CONFLICT(slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ict_password_vault_config(
 id boolean PRIMARY KEY DEFAULT true CHECK(id=true),salt text NOT NULL,
 verification_iv text NOT NULL,verification_ciphertext text NOT NULL,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ict_password_vault(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),encrypted_data text NOT NULL,iv text NOT NULL,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ict_password_vault_updated_at_idx ON public.ict_password_vault(updated_at DESC);
ALTER TABLE public.ict_password_vault_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ict_password_vault ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ICT vault config readable by authorised roles" ON public.ict_password_vault_config;
CREATE POLICY "ICT vault config readable by authorised roles" ON public.ict_password_vault_config
FOR SELECT TO authenticated USING(public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='ict_officer'));
DROP POLICY IF EXISTS "ICT vault config initialised by authorised roles" ON public.ict_password_vault_config;
CREATE POLICY "ICT vault config initialised by authorised roles" ON public.ict_password_vault_config
FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid() AND (public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='ict_officer')));
DROP POLICY IF EXISTS "ICT vault entries accessible by authorised roles" ON public.ict_password_vault;
CREATE POLICY "ICT vault entries accessible by authorised roles" ON public.ict_password_vault
FOR SELECT TO authenticated USING(public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='ict_officer'));
DROP POLICY IF EXISTS "ICT vault entries created by authorised roles" ON public.ict_password_vault;
CREATE POLICY "ICT vault entries created by authorised roles" ON public.ict_password_vault
FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid() AND updated_by=auth.uid() AND
 (public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='ict_officer')));
DROP POLICY IF EXISTS "ICT vault entries updated by authorised roles" ON public.ict_password_vault;
CREATE POLICY "ICT vault entries updated by authorised roles" ON public.ict_password_vault
FOR UPDATE TO authenticated USING(public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='ict_officer'))
WITH CHECK(updated_by=auth.uid() AND (public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='ict_officer')));
DROP POLICY IF EXISTS "ICT vault entries deleted by authorised roles" ON public.ict_password_vault;
CREATE POLICY "ICT vault entries deleted by authorised roles" ON public.ict_password_vault
FOR DELETE TO authenticated USING(public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='ict_officer'));

CREATE TABLE IF NOT EXISTS public.ict_password_vault_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vault_entry_id uuid,
 action text NOT NULL CHECK(action IN ('created','updated','deleted')),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ict_password_vault_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ICT vault audit read by directors" ON public.ict_password_vault_audit;
CREATE POLICY "ICT vault audit read by directors" ON public.ict_password_vault_audit
FOR SELECT TO authenticated USING(public.is_admin(auth.uid()));
REVOKE ALL ON public.ict_password_vault_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ict_password_vault_audit TO authenticated;
GRANT ALL ON public.ict_password_vault_audit TO service_role;

CREATE OR REPLACE FUNCTION public.tg_ict_password_vault_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_action text;
BEGIN
 IF TG_OP='DELETE' THEN v_id:=OLD.id; v_action:='deleted';
 ELSIF TG_OP='UPDATE' THEN v_id:=NEW.id; v_action:='updated';
 ELSE v_id:=NEW.id; v_action:='created'; END IF;
 INSERT INTO public.ict_password_vault_audit(vault_entry_id,action,actor_id)
 VALUES(v_id,v_action,auth.uid());
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_ict_password_vault_audit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_ict_password_vault_audit ON public.ict_password_vault;
CREATE TRIGGER trg_ict_password_vault_audit AFTER INSERT OR UPDATE OR DELETE ON public.ict_password_vault
FOR EACH ROW EXECUTE FUNCTION public.tg_ict_password_vault_audit();

GRANT SELECT,INSERT ON public.ict_password_vault_config TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ict_password_vault TO authenticated;
GRANT ALL ON public.ict_password_vault_config TO service_role;
GRANT ALL ON public.ict_password_vault TO service_role;
NOTIFY pgrst,'reload schema';