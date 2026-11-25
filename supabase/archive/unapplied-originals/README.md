# Archived unapplied migration drafts

These 37 SQL files were originally under `supabase/migrations/` but were not represented in the live Supabase migration history when the repair programme began.

They have been moved here **without changing their contents** so that:
- historical SQL is preserved for audit and comparison;
- duplicate timestamp prefixes no longer break the Supabase CLI migration scanner;
- superseded, partially applied, or unsafe draft SQL is not accidentally replayed by a future `supabase db push`.

**Do not execute these archived files.** The replacement migrations are the timestamped files remaining directly under `supabase/migrations/`. The replacements were committed to GitHub and applied to the live project `bdzuvszindioruovbcvh`.

Notable intentional exclusions:
- `20261107090000_allow_staff_deletion.sql`: not applied because it broadly alters dozens of foreign keys and could destroy or detach important HR/audit relationships. Leave staff accounts in place and deactivate/disable access through a controlled workflow instead.
- `20261112120000_backfill_missing_profiles.sql`: its intended effect was already satisfied; no replay needed.
- `fix_tax_filing_enum_compare.sql`: duplicate correction consolidated into the final document validation function.
