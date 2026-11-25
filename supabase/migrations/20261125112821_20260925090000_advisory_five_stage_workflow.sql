-- ============================================================================
-- Advisory workflow becomes a fixed 5-stage operational sequence:
--   Onboarding -> Evaluation/Analysis -> Guidance -> Invoicing -> Action
-- ("closed" remains as the terminal state used only by project close-out,
-- same as before -- it's just no longer counted among the 5 active stages.)
--
-- Remaps the old 7-value stage vocabulary (kickoff, information, analysis,
-- draft, review, signoff, closed) used on advisory_projects.stage and
-- advisory_milestones.stage onto the new one.
-- ============================================================================

ALTER TABLE public.advisory_projects ALTER COLUMN stage SET DEFAULT 'onboarding';

UPDATE public.advisory_projects SET stage = CASE stage
  WHEN 'kickoff'     THEN 'onboarding'
  WHEN 'information'  THEN 'evaluation'
  WHEN 'analysis'     THEN 'evaluation'
  WHEN 'draft'        THEN 'guidance'
  WHEN 'review'       THEN 'guidance'
  WHEN 'signoff'      THEN 'invoicing'
  ELSE stage -- 'closed' (or anything already migrated) is left as-is
END
WHERE stage IN ('kickoff','information','analysis','draft','review','signoff');

UPDATE public.advisory_milestones SET stage = CASE stage
  WHEN 'kickoff'     THEN 'onboarding'
  WHEN 'information'  THEN 'evaluation'
  WHEN 'analysis'     THEN 'evaluation'
  WHEN 'draft'        THEN 'guidance'
  WHEN 'review'       THEN 'guidance'
  WHEN 'signoff'      THEN 'invoicing'
  ELSE stage
END
WHERE stage IN ('kickoff','information','analysis','draft','review','signoff');
