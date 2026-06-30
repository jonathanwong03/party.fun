-- Migration: persistent AI assistant chat history (one rolling conversation per
-- user). RLS owner-only; the backend reads/writes it with the caller's JWT, so
-- users only ever see their own messages.

CREATE TABLE IF NOT EXISTS public."AI_CHAT_MESSAGES" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public."USER"(id) ON DELETE CASCADE,
  -- 'chat user' (not 'user') avoids confusion with the app's USER.role.
  role text NOT NULL CHECK (role IN ('chat user', 'assistant')),
  content text NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_chat_messages_user_created_idx
  ON public."AI_CHAT_MESSAGES" (user_id, created_at);

ALTER TABLE public."AI_CHAT_MESSAGES" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_chat own select" ON public."AI_CHAT_MESSAGES";
CREATE POLICY "ai_chat own select" ON public."AI_CHAT_MESSAGES"
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_chat own insert" ON public."AI_CHAT_MESSAGES";
CREATE POLICY "ai_chat own insert" ON public."AI_CHAT_MESSAGES"
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_chat own delete" ON public."AI_CHAT_MESSAGES";
CREATE POLICY "ai_chat own delete" ON public."AI_CHAT_MESSAGES"
  FOR DELETE USING (user_id = auth.uid());

REVOKE ALL ON public."AI_CHAT_MESSAGES" FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public."AI_CHAT_MESSAGES" TO authenticated;
