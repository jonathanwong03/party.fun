-- Migration: multiple saved AI conversations per user (history list).
--   AI_CHAT_CONVERSATIONS — one row per conversation (auto-titled).
--   AI_CHAT_MESSAGES.conversation_id — links each message to a conversation.
-- Existing rolling-history messages are backfilled into one conversation per user.
-- RLS owner-only throughout.

CREATE TABLE IF NOT EXISTS public."AI_CHAT_CONVERSATIONS" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public."USER"(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_chat_conversations_user_updated_idx
  ON public."AI_CHAT_CONVERSATIONS" (user_id, updated_at DESC);

ALTER TABLE public."AI_CHAT_CONVERSATIONS" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_conv own all" ON public."AI_CHAT_CONVERSATIONS";
CREATE POLICY "ai_conv own all" ON public."AI_CHAT_CONVERSATIONS"
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public."AI_CHAT_CONVERSATIONS" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."AI_CHAT_CONVERSATIONS" TO authenticated;

-- Link messages to a conversation.
ALTER TABLE public."AI_CHAT_MESSAGES"
  ADD COLUMN IF NOT EXISTS conversation_id uuid
  REFERENCES public."AI_CHAT_CONVERSATIONS"(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ai_chat_messages_conversation_idx
  ON public."AI_CHAT_MESSAGES" (conversation_id, created_at);

-- Backfill: bundle each user's existing messages into one conversation.
WITH users_with_msgs AS (
  SELECT DISTINCT user_id FROM public."AI_CHAT_MESSAGES" WHERE conversation_id IS NULL
), created AS (
  INSERT INTO public."AI_CHAT_CONVERSATIONS" (user_id, title)
  SELECT u.user_id,
         COALESCE((SELECT left(content, 60) FROM public."AI_CHAT_MESSAGES" m
                   WHERE m.user_id = u.user_id AND m.role = 'user' AND m.conversation_id IS NULL
                   ORDER BY created_at ASC LIMIT 1), 'Conversation')
  FROM users_with_msgs u
  RETURNING id, user_id
)
UPDATE public."AI_CHAT_MESSAGES" m
SET conversation_id = c.id
FROM created c
WHERE m.user_id = c.user_id AND m.conversation_id IS NULL;
