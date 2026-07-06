-- Migration: NOTIFICATION_LOGS — audit log of every email the notification
-- service sends (best-effort). Written
-- server-side only (service role); never exposed to anon/authenticated.

CREATE TABLE IF NOT EXISTS public."NOTIFICATION_LOGS" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  recipient_email text,
  event_id uuid,
  notification_type text,
  subject text,
  status text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_logs_event_type_idx
  ON public."NOTIFICATION_LOGS" (event_id, notification_type);

ALTER TABLE public."NOTIFICATION_LOGS" ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) reads/writes this table.
REVOKE ALL ON public."NOTIFICATION_LOGS" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public."NOTIFICATION_LOGS" TO service_role;
