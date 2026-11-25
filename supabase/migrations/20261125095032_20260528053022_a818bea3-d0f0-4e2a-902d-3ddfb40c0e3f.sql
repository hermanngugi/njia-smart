ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE public.audit_review_notes ADD COLUMN IF NOT EXISTS stage text;
CREATE INDEX IF NOT EXISTS idx_tasks_engagement_stage ON public.tasks(engagement_id, stage);
CREATE INDEX IF NOT EXISTS idx_review_notes_engagement_stage ON public.audit_review_notes(engagement_id, stage);