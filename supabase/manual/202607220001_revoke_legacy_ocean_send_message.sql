-- MANUAL, ONE-TIME CUTOVER ONLY. This file is deliberately outside
-- supabase/migrations so a normal `supabase db push` can never revoke a
-- cached Pages client's sender in the same release as the Edge migration.
--
-- Run only through `.github/workflows/revoke-legacy-ocean-send.yml` after the
-- production runbook's Pages/cache and telemetry checks have been recorded.
-- `supabase db query` accepts one prepared statement, so the locked checks,
-- REVOKE, and state update live atomically in this no-browser-grant routine.
select private.revoke_legacy_ocean_send_message();
