-- Consolidate overlapping permissive RLS policies without changing access semantics.
-- Also wrap request-scoped auth.uid() calls in scalar subqueries for initplan evaluation.
-- Restrictive policies (including paused-client and document confidentiality guards) are untouched.

DO $migration$
DECLARE
  cfg record;
  p_all record;
  p_select record;
  role_sql text;
  all_using text;
  all_check text;
  select_using text;
  policy_select text;
  policy_insert text;
  policy_update text;
  policy_delete text;
BEGIN
  FOR cfg IN
    SELECT *
    FROM (VALUES
      ('advisory_service_templates', 'advisory templates manage', 'advisory templates read'),
      ('advisory_template_controls', 'advisory template controls manage', 'advisory template controls read'),
      ('audit_procedure_definitions', 'audit procedure definitions admin manage', 'audit procedure definitions read financial staff'),
      ('audit_procedure_packs', 'audit procedure packs admin manage', 'audit procedure packs read financial staff'),
      ('client_obligation_assignees', 'client obligation assignees write full only', 'client obligation assignees select'),
      ('compliance_events', 'compliance admin manage', 'compliance select staff'),
      ('hr_employment', 'hr employment write hr managers', 'hr employment select self hr manager'),
      ('ict_knowledge_articles', 'ict knowledge manage ICT operators', 'ict knowledge read active staff'),
      ('ict_service_desk_team', 'ict team manage full module', 'ict team select staff'),
      ('ict_service_templates', 'ict templates manage full', 'ict templates read staff'),
      ('ict_template_controls', 'ict template controls manage full', 'ict template controls read staff'),
      ('invoice_handlers', 'invoice handlers write full only', 'invoice handlers select own or admin'),
      ('leave_types', 'leave types write admin', 'leave types read staff'),
      ('payslips', 'payslips write hr managers', 'payslips select self hr manager'),
      ('quick_links', 'quick links manage admin', 'quick links select staff'),
      ('user_roles', 'roles admin manage', 'roles select staff')
    ) AS x(table_name, all_policy_name, select_policy_name)
  LOOP
    SELECT * INTO p_all
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = cfg.table_name
      AND policyname = cfg.all_policy_name;

    SELECT * INTO p_select
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = cfg.table_name
      AND policyname = cfg.select_policy_name;

    IF p_all.policyname IS NULL OR p_select.policyname IS NULL THEN
      RAISE EXCEPTION 'Expected source policies missing on public.%: %, %',
        cfg.table_name, cfg.all_policy_name, cfg.select_policy_name;
    END IF;

    IF p_all.cmd <> 'ALL' OR p_select.cmd <> 'SELECT'
       OR p_all.permissive <> 'PERMISSIVE'
       OR p_select.permissive <> 'PERMISSIVE'
       OR p_all.roles <> p_select.roles
       OR p_all.qual IS NULL OR p_all.with_check IS NULL
       OR p_select.qual IS NULL THEN
      RAISE EXCEPTION 'Unexpected policy shape on public.%; refusing consolidation',
        cfg.table_name;
    END IF;

    SELECT string_agg(quote_ident(r::text), ', ')
      INTO role_sql
    FROM unnest(p_all.roles) AS r;

    all_using := regexp_replace(p_all.qual, 'auth[.]uid[(][)]', '(select auth.uid())', 'g');
    all_check := regexp_replace(p_all.with_check, 'auth[.]uid[(][)]', '(select auth.uid())', 'g');
    select_using := regexp_replace(p_select.qual, 'auth[.]uid[(][)]', '(select auth.uid())', 'g');

    policy_select := 'rls_consolidated_' || cfg.table_name || '_select';
    policy_insert := 'rls_consolidated_' || cfg.table_name || '_insert';
    policy_update := 'rls_consolidated_' || cfg.table_name || '_update';
    policy_delete := 'rls_consolidated_' || cfg.table_name || '_delete';

    EXECUTE format('DROP POLICY %I ON public.%I', cfg.all_policy_name, cfg.table_name);
    EXECUTE format('DROP POLICY %I ON public.%I', cfg.select_policy_name, cfg.table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR SELECT TO %s USING ((%s) OR (%s))',
      policy_select, cfg.table_name, role_sql, all_using, select_using
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR INSERT TO %s WITH CHECK (%s)',
      policy_insert, cfg.table_name, role_sql, all_check
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
      policy_update, cfg.table_name, role_sql, all_using, all_check
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR DELETE TO %s USING (%s)',
      policy_delete, cfg.table_name, role_sql, all_using
    );
  END LOOP;
END
$migration$;

-- documents: merge only the duplicate permissive policies by command.
-- Existing restrictive ALL policies for restricted documents, tax access and paused clients remain.
DROP POLICY "documents delete any documents user" ON public.documents;
DROP POLICY "documents delete owner or admin" ON public.documents;
DROP POLICY "documents insert any documents user" ON public.documents;
DROP POLICY "documents insert full only" ON public.documents;
DROP POLICY "documents select by rank" ON public.documents;
DROP POLICY "tax filing evidence metadata select" ON public.documents;

CREATE POLICY documents_select_consolidated
ON public.documents AS PERMISSIVE FOR SELECT TO authenticated
USING (
  (
    private.can_view_module_all((select auth.uid()), 'documents'::text)
    OR (
      private.is_module_assigned_only((select auth.uid()), 'documents'::text)
      AND (
        uploaded_by = (select auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.client_assignments ca
          WHERE ca.client_id = documents.client_id
            AND ca.user_id = (select auth.uid())
        )
      )
    )
  )
  OR (
    private.can_view_module((select auth.uid()), 'tax'::text)
    AND tax_return_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tax_returns t
      WHERE t.id = documents.tax_return_id
        AND t.client_id = documents.client_id
    )
  )
);

CREATE POLICY documents_insert_consolidated
ON public.documents AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  (
    private.can_view_module((select auth.uid()), 'documents'::text)
    AND uploaded_by = (select auth.uid())
    AND (
      confidentiality <> 'restricted'::text
      OR private.is_admin((select auth.uid()))
    )
  )
  OR private.has_full_module((select auth.uid()), 'documents'::text)
);

CREATE POLICY documents_delete_consolidated
ON public.documents AS PERMISSIVE FOR DELETE TO authenticated
USING (
  (
    private.can_view_module((select auth.uid()), 'documents'::text)
    AND (
      confidentiality <> 'restricted'::text
      OR private.is_admin((select auth.uid()))
    )
  )
  OR private.can_delete_record((select auth.uid()), 'documents'::text, uploaded_by)
);

-- profiles: combine the two permissive UPDATE predicates without changing the
-- effective USING rule. No explicit WITH CHECK existed on either source policy.
DROP POLICY "profiles admin update" ON public.profiles;
DROP POLICY "profiles update self" ON public.profiles;

CREATE POLICY profiles_update_consolidated
ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
USING (
  private.is_admin((select auth.uid()))
  OR id = (select auth.uid())
);
