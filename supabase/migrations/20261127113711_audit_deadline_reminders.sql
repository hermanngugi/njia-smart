-- Audit reminders and overdue alerts, added to the existing daily send_deadline_reminders() job
-- (pg_cron 'deadline-reminders', 07:00 Nairobi). Patches the live function text so the tax,
-- task, advisory and calendar parts stay exactly as they are. Safe to run twice.
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.send_deadline_reminders()'::regprocedure);
  v_block text := $blk$
  -- Audit steps: reminder to the step owner 3, 1 and 0 days before the due date
  FOR r IN
    SELECT s.id, s.engagement_id, s.procedure_id, s.due_date, s.assigned_to AS uid, (s.due_date - _today) AS d,
           e.title AS etitle, c.company_name, COALESCE(df.title, s.procedure_id) AS stitle
    FROM public.audit_engagement_procedures s
    JOIN public.engagements e ON e.id = s.engagement_id AND e.status::text <> 'completed'
    JOIN public.clients c ON c.id = e.client_id
    LEFT JOIN public.audit_procedure_definitions df ON df.pack_id = s.pack_id AND df.pack_version = s.pack_version AND df.procedure_id = s.procedure_id
    WHERE s.status NOT IN ('completed', 'not_applicable')
      AND s.assigned_to IS NOT NULL AND s.due_date IS NOT NULL
      AND COALESCE(c.is_paused, false) = false
      AND (s.due_date - _today) IN (3, 1, 0)
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
    VALUES (r.uid, 'deadline_reminder',
            'Audit step due ' || CASE r.d WHEN 0 THEN 'today' WHEN 1 THEN 'tomorrow' ELSE 'in ' || r.d || ' days' END,
            r.stitle || ' - ' || r.company_name || ' (' || r.etitle || ')',
            '/audit/' || r.engagement_id,
            'auditstep:' || r.id || ':' || r.due_date || ':d' || r.d)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  -- Audit steps: overdue alert to the step owner on day 1, 3, 7, then weekly
  FOR r IN
    SELECT s.id, s.engagement_id, s.assigned_to AS uid, (_today - s.due_date) AS late,
           e.title AS etitle, c.company_name, COALESCE(df.title, s.procedure_id) AS stitle
    FROM public.audit_engagement_procedures s
    JOIN public.engagements e ON e.id = s.engagement_id AND e.status::text <> 'completed'
    JOIN public.clients c ON c.id = e.client_id
    LEFT JOIN public.audit_procedure_definitions df ON df.pack_id = s.pack_id AND df.pack_version = s.pack_version AND df.procedure_id = s.procedure_id
    WHERE s.status NOT IN ('completed', 'not_applicable')
      AND s.assigned_to IS NOT NULL AND s.due_date < _today
      AND COALESCE(c.is_paused, false) = false
      AND ((_today - s.due_date) IN (1, 3, 7) OR ((_today - s.due_date) >= 14 AND (_today - s.due_date) % 7 = 0))
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
    VALUES (r.uid, 'deadline_reminder', 'Audit step OVERDUE',
            r.stitle || ' - ' || r.company_name || ' (' || r.etitle || ') - ' || r.late
              || CASE WHEN r.late = 1 THEN ' day' ELSE ' days' END || ' overdue',
            '/audit/' || r.engagement_id,
            'auditstepod:' || r.id || ':' || _today)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  -- Audit steps: nudge the reviewer when work has waited for review 1, 3, 7 days, then weekly
  FOR r IN
    SELECT s.id, s.engagement_id, s.assigned_reviewer_id AS uid, (_today - (s.updated_at AT TIME ZONE 'Africa/Nairobi')::date) AS waited,
           e.title AS etitle, c.company_name, COALESCE(df.title, s.procedure_id) AS stitle
    FROM public.audit_engagement_procedures s
    JOIN public.engagements e ON e.id = s.engagement_id AND e.status::text <> 'completed'
    JOIN public.clients c ON c.id = e.client_id
    LEFT JOIN public.audit_procedure_definitions df ON df.pack_id = s.pack_id AND df.pack_version = s.pack_version AND df.procedure_id = s.procedure_id
    WHERE s.status IN ('prepared', 'under_review')
      AND s.assigned_reviewer_id IS NOT NULL
      AND COALESCE(c.is_paused, false) = false
      AND ((_today - (s.updated_at AT TIME ZONE 'Africa/Nairobi')::date) IN (1, 3, 7)
           OR ((_today - (s.updated_at AT TIME ZONE 'Africa/Nairobi')::date) >= 14 AND (_today - (s.updated_at AT TIME ZONE 'Africa/Nairobi')::date) % 7 = 0))
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
    VALUES (r.uid, 'deadline_reminder', 'Audit step waiting for your review',
            r.stitle || ' - ' || r.company_name || ' (' || r.etitle || ') - waiting ' || r.waited
              || CASE WHEN r.waited = 1 THEN ' day' ELSE ' days' END,
            '/audit/' || r.engagement_id,
            'auditrev:' || r.id || ':' || _today)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  -- Audit steps sent back: remind the owner 1, 3, 7 days after the reviewer's comment
  FOR r IN
    SELECT s.id, s.engagement_id, s.assigned_to AS uid, (_today - (s.updated_at AT TIME ZONE 'Africa/Nairobi')::date) AS waited,
           e.title AS etitle, c.company_name, COALESCE(df.title, s.procedure_id) AS stitle
    FROM public.audit_engagement_procedures s
    JOIN public.engagements e ON e.id = s.engagement_id AND e.status::text <> 'completed'
    JOIN public.clients c ON c.id = e.client_id
    LEFT JOIN public.audit_procedure_definitions df ON df.pack_id = s.pack_id AND df.pack_version = s.pack_version AND df.procedure_id = s.procedure_id
    WHERE s.status = 'review_notes' AND s.assigned_to IS NOT NULL
      AND COALESCE(c.is_paused, false) = false
      AND (_today - (s.updated_at AT TIME ZONE 'Africa/Nairobi')::date) IN (1, 3, 7)
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
    VALUES (r.uid, 'deadline_reminder', 'Audit step sent back',
            r.stitle || ' - ' || r.company_name || ' (' || r.etitle || ') - the reviewer asked for changes',
            '/audit/' || r.engagement_id,
            'auditback:' || r.id || ':' || _today)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  -- Audit engagements: reminder to the owner 7, 3, 1, 0 days before the due date, then overdue alerts
  FOR r IN
    SELECT e.id, e.title, e.due_date, e.assigned_to AS uid, c.company_name, (e.due_date - _today) AS d
    FROM public.engagements e
    JOIN public.clients c ON c.id = e.client_id
    WHERE e.type::text = 'audit' AND e.status::text <> 'completed'
      AND e.assigned_to IS NOT NULL AND e.due_date IS NOT NULL
      AND COALESCE(c.is_paused, false) = false
      AND ((e.due_date - _today) IN (7, 3, 1, 0)
           OR (e.due_date < _today AND ((_today - e.due_date) IN (1, 3, 7)
               OR ((_today - e.due_date) >= 14 AND (_today - e.due_date) % 7 = 0))))
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
    VALUES (r.uid, 'deadline_reminder',
            CASE WHEN r.d < 0 THEN 'Audit OVERDUE'
                 ELSE 'Audit due ' || CASE r.d WHEN 0 THEN 'today' WHEN 1 THEN 'tomorrow' ELSE 'in ' || r.d || ' days' END END,
            r.company_name || ' - ' || r.title || CASE WHEN r.d < 0 THEN ' - ' || (-r.d) || ' days overdue' ELSE ' - due ' || to_char(r.due_date, 'DD Mon YYYY') END,
            '/audit/' || r.id,
            'audit:' || r.id || ':' || _today)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  -- Audit: one daily digest for directors/admins (engagements past due, late steps, engagements with no owner)
  SELECT count(*) FILTER (WHERE e.due_date < _today),
         count(*) FILTER (WHERE e.assigned_to IS NULL)
    INTO v_overdue, v_unassigned
    FROM public.engagements e JOIN public.clients c ON c.id = e.client_id
   WHERE e.type::text = 'audit' AND e.status::text <> 'completed' AND COALESCE(c.is_paused, false) = false;
  SELECT count(*) INTO v_late_steps
    FROM public.audit_engagement_procedures s
    JOIN public.engagements e ON e.id = s.engagement_id AND e.status::text <> 'completed'
    JOIN public.clients c ON c.id = e.client_id
   WHERE s.status NOT IN ('completed', 'not_applicable') AND s.due_date < _today AND COALESCE(c.is_paused, false) = false;

  IF v_overdue > 0 OR v_late_steps > 0 OR v_unassigned > 0 THEN
    FOR r IN SELECT DISTINCT ur.user_id AS uid FROM public.user_roles ur WHERE ur.role::text IN ('director', 'admin')
    LOOP
      INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
      VALUES (r.uid, 'deadline_reminder', 'Audit status',
              v_overdue || ' engagement' || CASE WHEN v_overdue = 1 THEN '' ELSE 's' END || ' overdue, '
                || v_late_steps || ' late step' || CASE WHEN v_late_steps = 1 THEN '' ELSE 's' END
                || CASE WHEN v_unassigned > 0 THEN ', ' || v_unassigned || ' with no owner' ELSE '' END,
              CASE WHEN v_overdue > 0 THEN '/audit?status=overdue' ELSE '/audit' END,
              'auditdigest:' || _today)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END LOOP;
  END IF;

$blk$;
BEGIN
  IF v_def LIKE '%auditdigest:%' THEN RETURN; END IF;
  IF position('  v_unassigned int;' || E'\n' || 'BEGIN' in v_def) = 0 OR position('  -- Advisory milestones' in v_def) = 0 THEN
    RAISE EXCEPTION 'send_deadline_reminders() has an unexpected shape; not patching';
  END IF;
  v_def := replace(v_def, '  v_unassigned int;' || E'\n' || 'BEGIN', '  v_unassigned int;' || E'\n' || '  v_late_steps int;' || E'\n' || 'BEGIN');
  v_def := replace(v_def, '  -- Advisory milestones', v_block || '  -- Advisory milestones');
  EXECUTE v_def;
END
$mig$;
