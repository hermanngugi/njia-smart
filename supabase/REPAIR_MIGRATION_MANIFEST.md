# Njia Smart repair migration manifest

**Live Supabase project:** `bdzuvszindioruovbcvh`  
**Repository:** `hermanngugi/njia-smart`  
**Branch:** `main`

This manifest records the consolidated repair sequence applied to the live project. The SQL files were applied in dependency order. The first 14 digits of each active migration filename now match the live Supabase migration-history version; the following segment preserves the original logical filename and timestamp. The 37 unapplied drafts are archived under `supabase/archive/unapplied-originals/` and must not be replayed.

## Applied sequence

| Order | Migration | Scope |
|---:|---|---|
| 1 | `20261125191448_20261125221500_core_security_and_client_pause.sql` | Complete staff-role recognition, activation guard, paused-client policies |
| 2 | `20261125191524_20261125223000_central_documents_and_storage_security.sql` | Central document library, metadata validation, restricted document and Storage rules |
| 3 | `20261125191541_20261125224500_service_module_schema_repair.sql` | Service project and milestone schema drift |
| 4 | `20261125191603_20261125230000_hr_leave_workflow_retention.sql` | Reliever workflow, two-stage approval, atomic handover, audited reset, archive instead of hard delete |
| 5 | `20261125191629_20261125231500_task_workspace_weekly_planning.sql` | Weekly planning, task workspace, subtasks, outputs, progress and waiting-on-client |
| 6 | `20261125191644_20261125233000_chat_notifications_repair.sql` | Team membership, personal chat hide/restore, mentions, notification actor |
| 7 | `20261125191709_20261125234500_tax_filing_invoice_period_controls.sql` | Filing periods, duplicate prevention, monthly periods, invoice batching |
| 8 | `20261125191726_20261125235000_tax_invoice_period_guard_fix.sql` | Invoice RPC ambiguity correction and one-filed-per-window guard |
| 9 | `20261125191744_20261125240000_audit_review_signoff_controls.sql` | Risk/procedure links, reviewer assignment, controlled sign-off and completion gates |
| 10 | `20261125191802_20261125241500_ict_knowledge_vault_security.sql` | ICT knowledge base, restricted encrypted vault and change audit trail |
| 11 | `20261125191818_20261125243000_task_notification_integrity.sql` | Notification actor immutability, subtask guard and task activity logging |
| 12 | `20261125191903_20261125244500_security_definer_rpc_lockdown.sql` | Remove anonymous execution from public SECURITY DEFINER functions; set fixed search paths |
| 13 | `20261125191922_20261125245500_revoke_trigger_function_rpc.sql` | Remove direct RPC execution from trigger functions |
| 14 | `20261125191944_20261125250000_tax_period_window_and_pause_fix.sql` | Enforce filing window on inserts and exclude paused clients from batch scheduling |
| 15 | `20261125192017_20261125251000_paused_client_storage_guard.sql` | Extend paused-client boundary to client document objects in Storage |
| 16 | `20261125192319_20261125252000_ict_updated_at_triggers.sql` | Maintain ICT knowledge-base and vault update timestamps |
| 17 | `20261125192452_20261125253000_task_output_owner_delete.sql` | Allow task output owners to delete their own Storage files |
| 18 | `20261125192542_20261125254000_chat_staff_role_revocation.sql` | Remove chat access and membership when staff roles are revoked |
| 19 | `20261125192551_20261125254500_chat_membership_trigger_return_fix.sql` | Correct staff membership trigger return semantics |
| 20 | `20261125192616_20261125255000_completion_invoice_access_guard.sql` | Enforce module assignment and paused-client checks in completion invoicing |
| 21 | `20261125192641_20261125255500_internal_rpc_and_portal_guard.sql` | Restrict internal RPC helpers and client portal password changes |
| 22 | `20261125192721_20261125260000_paused_client_row_and_chat_guard.sql` | Restrict paused client rows and client-linked chat access |
| 23 | `20261125192755_20261125261000_tax_document_module_guard.sql` | Keep tax filing documents behind Tax-module access |
| 24 | `20261125192818_20261125262000_invoice_number_concurrency_guard.sql` | Serialize invoice number allocation across concurrent requests |
| 25 | `20261125200628_20261125270000_security_definer_private_api_boundary.sql` | Move 42 privileged implementations into non-exposed `private` schema and preserve authenticated RPC signatures as invoker wrappers |
| 26 | `20261125203916_consolidate_permissive_rls_policies.sql` | Consolidate 20 multiple-permissive-policy findings across 18 tables; split ALL policies by command, preserve restrictive guards, and apply auth.uid() initplan optimization to affected policies |
| 27 | `20261125204519_fk_supporting_indexes_batch_01_advisory_audit.sql` | Add 28 FK-supporting indexes across advisory, announcements, audit and chat |
| 28 | `20261125204538_fk_supporting_indexes_batch_02_client_documents_hr_ict.sql` | Add 28 FK-supporting indexes across client, documents, HR and ICT |
| 29 | `20261125204544_fk_supporting_indexes_batch_03_invoices_leave_tasks.sql` | Add 28 FK-supporting indexes across invoices, leave, payments, tasks and related tables |
| 30 | `20261125204553_fk_supporting_indexes_batch_04_tax_and_remaining.sql` | Add the final 28 FK-supporting indexes, including tax relationships |
| 31 | `20261126052912_optimize_rls_auth_uid_initplans.sql` | Wrap request-scoped auth.uid() calls in scalar subqueries across affected RLS policy expressions; preserve all policy predicates and guards |

## Superseded draft files

The 37 unrecorded draft migrations have been moved, byte-for-byte, to `supabase/archive/unapplied-originals/`. This also removes duplicate timestamp prefixes from the active migration directory. The archive README explains why they must not be executed.

The broad staff-deletion migration was deliberately not applied: it changed many unrelated foreign keys and could compromise historical HR/audit records. Leave record deletion is implemented as archival. Staff deletion should use a separately designed deactivation process.

The profile backfill draft was not applied because its intended effect was already satisfied. The unversioned tax enum correction was merged into the final document validation function.

## Verification snapshot

The live project was checked after deployment:
- 67 public tables; all 67 have RLS enabled.
- 16 restrictive paused-client guards on client-linked public tables, plus a restrictive paused-client guard on `clients` itself.
- Restricted-document and paused-client Storage guards present.
- All 31 consolidated repair migrations appear in the live migration history, including four staged FK-index batches (112 indexes across 55 tables) and the RLS initplan optimization.
- All 102 active local migration filenames have unique version prefixes matching the live ledger; the two additional remote entries are the baseline files intentionally kept under `supabase/baseline/`.
- No `public`-schema SECURITY DEFINER function remains executable by `anon` or `authenticated`.
- 42 SECURITY DEFINER implementations are in the non-exposed `private` schema; their public API wrappers run as SECURITY INVOKER and preserve the existing signatures.
- Authenticated direct calls to user-ID permission helpers are restricted to the caller's own user ID.
- All 42 private implementations and public wrappers retain pinned search paths.
- Trigger functions are not directly executable by `authenticated`.
- Private `task-outputs` bucket exists; uploaders and task leads can delete files according to the same ownership rules as task-output metadata.
- The obsolete four-argument `request_leave` RPC was removed; the five-argument reliever-aware RPC remains.

## Outstanding platform/security follow-up

Supabase Security Advisor still reports:
- Leaked-password protection is disabled. Enable it in Supabase Dashboard → Authentication → Security and Password settings.
- Performance Advisor reports zero remaining RLS initplan findings after the auth.uid() scalar-subquery optimization. All 112 missing foreign-key indexes have been added. Unused-index notices remain under observation; no indexes have been dropped.

## Important operational note

The repository's `supabase/config.toml` now points to the live project reference above. Future migrations should be created with the Supabase CLI, reviewed against this manifest and the live migration ledger, then applied once. Do not manually replay the archived SQL.
