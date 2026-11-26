-- New staff role categories: marketing, tax assistant, audit assistant,
-- and internal administration.
--
-- Enum values must be committed before they can be referenced, so this file
-- ONLY adds the values. The functions/policies that use them live in
-- 20260925060500_staff_role_access_controls.sql (a separate transaction).
alter type public.app_role add value if not exists 'marketing';
alter type public.app_role add value if not exists 'tax_assistant';
alter type public.app_role add value if not exists 'audit_assistant';
alter type public.app_role add value if not exists 'internal_admin';
