-- Migration: AI_USER_MEMORY — durable per-user preferences the agent LEARNS and
-- reads back to personalise (interests/budget/vibe for attendees; venue/theme/
-- pricing preferences for organisers). RLS owner-only; the advisor reads/writes
-- an organiser's memory via the service role.

CREATE TABLE IF NOT EXISTS public."AI_USER_MEMORY" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public."USER"(id) ON DELETE CASCADE,
  content text NOT NULL,
  category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_user_memory_user_created_idx
  ON public."AI_USER_MEMORY" (user_id, created_at DESC);

ALTER TABLE public."AI_USER_MEMORY" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_memory own select" ON public."AI_USER_MEMORY";
CREATE POLICY "ai_memory own select" ON public."AI_USER_MEMORY"
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_memory own insert" ON public."AI_USER_MEMORY";
CREATE POLICY "ai_memory own insert" ON public."AI_USER_MEMORY"
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_memory own delete" ON public."AI_USER_MEMORY";
CREATE POLICY "ai_memory own delete" ON public."AI_USER_MEMORY"
  FOR DELETE USING (user_id = auth.uid());

REVOKE ALL ON public."AI_USER_MEMORY" FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public."AI_USER_MEMORY" TO authenticated;
GRANT SELECT, INSERT ON public."AI_USER_MEMORY" TO service_role;
