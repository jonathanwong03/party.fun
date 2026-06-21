# Issue 04: Environment & ops documentation

**Status:** ready-for-agent

## Parent

`.scratch/transactional-email-notifications/PRD.md`

## What to build

Document the notification environment variables and the three-environment email routing policy so developers and staging deploys do not accidentally email demo accounts or misconfigure Resend.

Add a `backend/.env.example` (or equivalent) and extend `README.md` with the notification configuration section.

## Acceptance criteria

- [ ] `README.md` documents `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, and `NOTIFICATION_OVERRIDE_EMAIL`
- [ ] README explains three-environment policy:
  - **Local dev:** no `RESEND_API_KEY` → mock mode (console preview, `mock_sent` logs)
  - **Shared staging:** `NOTIFICATION_OVERRIDE_EMAIL` required → all mail to team inbox
  - **Production:** no override → real recipients, `sent`/`failed` logs
- [ ] `backend/.env.example` includes all notification env vars with comments explaining each
- [ ] Docs note that `recipient_email` in `notification_logs` stores the intended recipient even when override redirects delivery
- [ ] Docs reference `CONTEXT.md` and `docs/adr/0001-transactional-email-notifications.md` for domain and architecture context

## Blocked by

- Issue 01 (`01-pledge-confirmed-email.md`)
