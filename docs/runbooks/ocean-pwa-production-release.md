# Ocean PWA production release runbook

This runbook releases the forward-only PWA hardening migration and its Edge
Functions without replaying a destructive historical launch migration against
an existing production database.

## Prerequisites

- The migration history has been compared with the linked Supabase project:
  `supabase migration list --linked`.
- A point-in-time restore has been exercised on a non-production project from a
  current backup. Record the restore timestamp and the successful smoke query
  in the deployment ticket.
- The `production` GitHub Environment has secrets: `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_VAPID_PUBLIC_KEY`, and the private
  scheduler-only `SCHEDULED_JOB_SECRET`. It also has `VITE_PUBLIC_APP_URL` and
  `VITE_BASE_PATH` environment variables.
- Supabase Edge secrets exist: `MODERATION_ENDPOINT`, `MODERATION_API_KEY`,
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
  `SCHEDULED_JOB_SECRET`, and optionally `ALLOWED_WEB_ORIGINS`.
- `MODERATION_ENDPOINT` has been exercised with both an allowed and a rejected
  payload. Its response must contain a recognizable allow/block verdict; an
  unrecognized response intentionally fails closed.

Generate the VAPID pair once, then put only the public key in the Pages secret:

```bash
npx --yes web-push@3.6.7 generate-vapid-keys
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  VAPID_PUBLIC_KEY='...' VAPID_PRIVATE_KEY='...' \
  VAPID_SUBJECT='mailto:operations@example.com' \
  SCHEDULED_JOB_SECRET='...'
gh secret set VITE_VAPID_PUBLIC_KEY --env production --repo sorryrlrud/DoongDoong --body '...'
gh secret set SCHEDULED_JOB_SECRET --env production --repo sorryrlrud/DoongDoong --body '...'
```

Never place `VAPID_PRIVATE_KEY`, the moderation credential, a service-role key,
or the scheduled-job secret in a Vite environment variable. The scheduler
secret is used only by the repository's five-minute GitHub Actions dispatcher;
the dispatch function first advances lifecycle and assigns bottles, then sends
Push work.

## Existing-project baseline

Do not run `supabase db push` against a project whose migration ledger is empty
but whose schema/data already exists. That would replay the historical
launch/reset migrations and can delete live data.

Before any production apply:

1. Provision a recoverable backup path. Supabase Free does not provide
   scheduled backups or PITR, so upgrade to a plan with recovery or create and
   successfully restore an encrypted logical backup into a separate staging
   project first.
2. Compare the live schema with the repository's pre-hardening schema and
   record the result. The historical migration versions can be marked as
   applied only when every required schema object is confirmed equivalent.
3. Use `supabase migration repair --linked --status applied <versions>` to
   establish the verified historical baseline. This records history only; it
   must not execute a reset or data-deleting migration.
4. Confirm `supabase migration list --linked` shows the repaired baseline, then
   apply only `202607210001` (and later forward migrations).

The repair list must be approved from a schema-diff review, not copied blindly.
Historical one-off/reset files are never replayed on a live project.

## Release order

The send-path transition has two explicit phases. Do not collapse them into a
single `db push`/Pages deployment: an installed Pages bundle can keep calling
the historical `ocean_send_message` RPC until it refreshes.

1. Run `npm run check`, `node scripts/check-migrations.mjs`, local Supabase
   replay, and the supplied database tests.
2. Merge the exact reviewed commit to `main`. The automatically triggered Pages
   workflow must stop at its backend preflight while production still lacks the
   new contract, leaving the previous Pages deployment live. Record that failed
   preflight as evidence that the client cannot overtake the backend.
3. From that exact `main` commit, manually dispatch **Deploy Supabase phase-one
   compatibility contract** with `DEPLOY`, `BASELINE_VERIFIED`, and
   `COMPATIBILITY_RELEASE`. It deploys the compatible Edge Functions first,
   then applies `202607210001`, then deploys translation. The migration
   intentionally leaves an authenticated compatibility facade for
   `ocean_send_message` enabled.
4. Verify the linked migration list, call
   `POST /rest/v1/rpc/ocean_pwa_contract_status` with the publishable key, and
   check that it returns `{"sendMessage":"edge-v1", ...}`. Smoke-test the
   new authenticated `/functions/v1/send-message` path and invoke the
   scheduled lifecycle/assignment job once with its internal secret.
5. Re-run the Pages workflow for that same `main` commit. It probes both
   `OPTIONS /functions/v1/send-message` and `ocean_pwa_contract_status` before
   building; if either probe fails, the prior Pages deployment remains live.
6. Validate the public Pages URL in a fresh browser profile: service worker
   scope, installability, authenticated Edge send, assigned arrival,
   notification preference, and account deletion. Also exercise a retained
   pre-release client artifact once: its direct RPC send must still return a
   snapshot and create a `drifting` message rather than an `available` row.
7. Observe the compatibility window. The direct facade retains old-client
   availability but cannot use managed moderation, so it is deliberately
   time-limited. Keep the matching Edge-client Pages artifact live for at
   least 30 days, retain its deployment/cache evidence, and confirm aggregate
   telemetry shows no successful legacy RPC call for at least 14 days.
8. Only then manually dispatch **Revoke legacy Ocean sender** with
   `REVOKE_LEGACY_SEND` and `PAGES_AND_TELEMETRY_VERIFIED`. It runs
   `supabase/manual/202607220001_revoke_legacy_ocean_send_message.sql`, which
   invokes a transactionally gated private routine that independently enforces
   the 30-day Phase 1 and 14-day quiet-period checks before revoking the
   authenticated RPC grant. This SQL is intentionally outside
   `supabase/migrations`; normal deployment can never apply it.
9. Repeat the new-client send smoke test after the revoke and record the
   aggregate cutover row, Pages deployment URL, and workflow run URLs in the
   release ticket.

The compatibility facade authenticates the caller, requires a supported social
identity, applies the locked per-minute/daily limits, derives the date label
server-side, and writes only the new `drifting` model. It is not a substitute
for managed moderation; all new clients use the Edge endpoint, and the manual
revoke is mandatory once the cache/usage window has elapsed.

## Rollback

The schema migration is forward-only. Do not use `db reset`, a historical
destructive migration, or a rollback by deleting rows in production. If the
frontend is at fault, redeploy the prior Pages artifact/commit. If an Edge
Function is at fault, redeploy its prior revision while leaving the compatible
database schema in place. For data corruption, follow the verified PITR runbook
and preserve the incident timestamp before restoring.

Before the manual legacy revoke, a failed new Pages build leaves the prior
artifact and its compatibility RPC working. After the revoke, do not silently
regrant the legacy RPC during an incident: restore the known-good Edge/Pages
revision first, then use a reviewed forward fix if the contract itself is at
fault.

## Post-release checks

- `ocean_snapshot` does not update global `messages` state.
- A due bottle is assigned even when the recipient's notification preference is
  off; no outbox record is created in that case.
- An enabled subscription receives a payload containing only notification ID,
  title/body, relative catch URL, and opaque tag.
- A 404/410 endpoint is disabled and a 429/5xx endpoint has a bounded retry.
- The privacy notice matches account anonymization, Push capability URLs, and
  provider moderation handling.
