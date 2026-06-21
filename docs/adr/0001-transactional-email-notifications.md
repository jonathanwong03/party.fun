---
status: accepted
---

# Transactional email notifications

party.fun sends transactional emails (pledge confirmed, tickets given away, event greenlit) via Resend from the Express backend. We decided that email delivery is a **side effect** of domain actions — pledges, give-aways, and greenlighting succeed even if Resend is down or logging fails. Failed sends are recorded in `notification_logs` as `failed`; they never roll back the underlying mutation.

Greenlit fan-out must reach every user with active tickets on an event, which requires reading other users' email addresses. The backend otherwise forwards the caller's JWT and does not use the service-role key (see README). Recipient lookup therefore lives in a **`SECURITY DEFINER` Postgres RPC** (e.g. `get_event_notification_recipients`), not in direct `USER` table queries through RLS.

**Considered options:** (1) service-role Supabase client on the backend for notification reads — rejected because it breaks the "JWT-only backend" model and widens the blast radius of a leaked key; (2) failing the API when email fails — rejected because payment capture and ticket allocation are the source of truth, not email delivery; (3) message queue / outbox with guaranteed delivery — deferred to v2.

**Environment routing:** local dev runs in mock mode (no `RESEND_API_KEY`, console preview, log as `mock_sent`); shared staging requires `NOTIFICATION_OVERRIDE_EMAIL` so demo-account inboxes are not hit; production sends to real recipients and logs `sent` or `failed`.

**v1 scope:** pledge confirmed, tickets given away (partial or full), greenlit fan-out. Out of scope: deadline-failure refunds, organiser cancellation, soft-delete from profile. Triggers live in controllers for v1; move to `eventService` / a `notificationOrchestrator` when scheduled jobs and additional mutation paths are added.

**Consequences:** users may complete an action without receiving email if Resend fails; ops must monitor `notification_logs` and console output. Greenlit fan-out depends on the RPC being added to the Supabase schema. Template variables from user input must be HTML-escaped before rendering.
