-- ── Audit log (money + admin-moderation actions) ─────────────────────────────
-- Append-only trail of the high-stakes, irreversible actions: pledges, top-ups, refunds, payouts,
-- cancellations, and admin edits/cancellations. Observational — written best-effort by the backend
-- (services/auditLog.js) via the service-role client. Readable only by admins; there is
-- deliberately NO insert/update/delete policy for end users (append-only, service-role writes).

create table if not exists public."AUDIT_LOG" (
  id            bigserial primary key,
  "actorUserId" uuid,
  action        text not null,
  "targetType"  text,
  "targetId"    text,
  amount        numeric,
  metadata      jsonb,
  "createdAt"   timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public."AUDIT_LOG" ("createdAt" desc);

alter table public."AUDIT_LOG" enable row level security;
drop policy if exists audit_log_admin_read on public."AUDIT_LOG";
create policy audit_log_admin_read on public."AUDIT_LOG" for select to authenticated using (public.is_admin());
