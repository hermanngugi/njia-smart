DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.engagements; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_workpapers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_review_notes; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
ALTER TABLE public.engagements REPLICA IDENTITY FULL;
ALTER TABLE public.audit_workpapers REPLICA IDENTITY FULL;
ALTER TABLE public.audit_review_notes REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;