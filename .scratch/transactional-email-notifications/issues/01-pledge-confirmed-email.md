# Issue 01: Pledge confirmed email (end-to-end, mock mode)

**Status:** implemented (pending Supabase migration for `notification_logs`)

## Parent

`.scratch/transactional-email-notifications/PRD.md`

## What to build

After a successful pledge (`POST /api/checkout/:eventId/pledge`), send a **pledge confirmed** transactional email to the pledging user. Payment is captured at pledge time (not on greenlight). The email includes event title, ticket quantity, price per ticket, total, and funding deadline.

Delivery is fire-and-forget: the pledge API always returns `{ status: 'ok', event, profile }` even if Resend or logging fails. Locally (no valid `RESEND_API_KEY`), emails preview in the console and log as `mock_sent`. Each attempt is recorded in `notification_logs`.

Establish the shared notification infrastructure used by later slices: email processor (mock mode, retry, staging override support), notification logging, HTML escape helper, and the first branded template.

## Acceptance criteria

- [ ] `notification_logs` table exists in Supabase schema and is documented in `DBTABLES.md` with columns: `user_id`, `recipient_email`, `event_id`, `notification_type`, `subject`, `status` (`sent` | `mock_sent` | `failed`), `error_message`, `sent_at`, `created_at`
- [ ] `sendEmail` supports mock mode (no/placeholder `RESEND_API_KEY` → console preview), Resend retry (2 attempts), and `NOTIFICATION_OVERRIDE_EMAIL` redirect while logging the original recipient
- [ ] Pledge confirmed template states payment was **captured now** and explains refund-if-not-greenlit by deadline — no "charged on greenlight" language
- [ ] All user-supplied template variables (`username`, `eventTitle`, etc.) are HTML-escaped
- [ ] `notifyPledgeConfirmed` fires after successful pledge only; not on `404`/`409` error paths
- [ ] Mock sends log `mock_sent`; real Resend success logs `sent`; exhausted retries log `failed`
- [ ] Logging failures never throw or block the API response
- [ ] Unit tests: email processor (mock mode, override, retry success, retry exhausted)
- [ ] Unit tests: pledge template (capture-at-pledge copy, HTML escaping)
- [ ] HTTP integration test: successful pledge returns `200` + `{ status: 'ok' }` and triggers stubbed `sendEmail` with correct recipient and subject fragment
- [ ] Manual: local dev without `RESEND_API_KEY` shows console mock preview and `mock_sent` log entry

## Blocked by

None — can start immediately
