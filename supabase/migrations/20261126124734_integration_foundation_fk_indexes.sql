-- Supporting indexes for every foreign key introduced by the integration foundation.
create index if not exists client_integrations_connected_by_idx
  on public.client_integrations (connected_by);
create index if not exists client_integrations_created_by_idx
  on public.client_integrations (created_by);
create index if not exists integration_auth_states_initiated_by_idx
  on public.integration_auth_states (initiated_by);
create index if not exists integration_record_mappings_integration_client_fk_idx
  on public.integration_record_mappings (integration_id, client_id);
create index if not exists integration_sync_runs_integration_client_fk_idx
  on public.integration_sync_runs (integration_id, client_id);
create index if not exists integration_sync_runs_requested_by_idx
  on public.integration_sync_runs (requested_by);
create index if not exists integration_webhook_events_integration_client_fk_idx
  on public.integration_webhook_events (integration_id, client_id);
create index if not exists integration_operations_integration_client_fk_idx
  on public.integration_operations (integration_id, client_id);
create index if not exists integration_operations_requested_by_idx
  on public.integration_operations (requested_by);
create index if not exists integration_operations_approved_by_idx
  on public.integration_operations (approved_by);
create index if not exists integration_operations_executed_by_idx
  on public.integration_operations (executed_by);
