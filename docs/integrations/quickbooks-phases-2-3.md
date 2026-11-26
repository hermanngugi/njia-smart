# QuickBooks Online — Phases 2 and 3 (Development Sandbox)

## Phase 2: read-only synchronisation

The client Integrations tab exposes manual synchronisation for QuickBooks Customer, Invoice and Payment entities.

- Initial and full syncs fetch all available pages (1,000 records per request).
- Incremental syncs use the last successful per-entity MetaData.LastUpdatedTime cursor.
- OAuth access-token refresh and one-time 401 retry are handled server-side.
- Only allow-listed fields are retained in integration_external_records; full provider payloads, tokens and payment data are not stored.
- Upserts are idempotent on (integration_id, external_record_type, external_record_id).
- Each run is recorded in integration_sync_runs.
- The mirror is separate from operational clients, invoices and payments. No automatic local-accounting writes or matching by display name occur.

The migration 20261126150000_qbo_sync_mirror.sql creates the mirror table with RLS enabled, browser-role privileges revoked, and service-role-only access. Apply it only to an isolated development/staging Supabase project first. Do not apply to a Supabase project shared with Production until a separate backup and release approval.

## Phase 3: approval-gated accounting writes

Supported controlled operations:
- Create a QuickBooks Invoice using an existing QuickBooks Customer ID and Item ID.
- Record a QuickBooks Payment using an existing Customer ID and Deposit Account ID, optionally linked to an Invoice ID.

Workflow:
1. An Accountant, Director or Admin submits a validated operation.
2. It is recorded as pending_approval; no provider API request is made.
3. A different Director/Admin approves or rejects it.
4. A Director/Admin executes an approved operation.
5. The operation is claimed atomically (approved → executing) and sent to the sandbox with a stable QuickBooks requestid derived from its idempotency key.
6. The external ID and sanitised result are retained in integration_operations.

A requester cannot approve their own operation. Raw card data and QuickBooks credentials are never accepted in operation payloads. The current write workflow is limited to QuickBooks sandbox and must not be enabled against production credentials.

## Required configuration

Server-side Preview variables only: QBO_ENVIRONMENT=sandbox, QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

Never prefix secrets with VITE_ or expose them to browser code.

## Verification status and release checklist

The code and migration are staged on integrations-phase-2-3. No migration has been applied to the shared Supabase project, no sandbox company has been synchronised, and no invoice/payment write has been executed.

Before enabling data actions:
1. Provision an isolated staging Supabase project; Preview must not write to Production data.
2. Apply the new mirror migration to staging and verify RLS/privileges.
3. Configure Preview environment variables and Intuit's exact callback URL.
4. Connect a dedicated Intuit sandbox company.
5. Run initial sync and verify Customers, Invoices and Payments in the mirror.
6. Test incremental sync, pagination, retries, and duplicate handling.
7. Test Phase 3 using only Intuit's sandbox test company and a different approver.
8. Review Vercel build/runtime logs and Supabase security/performance advisors.
9. Keep the PR unmerged until review and explicit release approval.

## Not included

- Automatic creation or updating of Njia Smart's own invoices/payments from mirrored QuickBooks records.
- Production Intuit credentials or live payment processing.
- KRA eTIMS, Xero or Sage provider connectors.
- M-PESA, WhatsApp, Google Workspace or Microsoft 365.