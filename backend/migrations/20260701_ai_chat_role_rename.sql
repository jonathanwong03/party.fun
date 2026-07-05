-- Migration: rename the AI chat message sender role 'user' -> 'chat user' so it
-- isn't confused with the app's USER.role. 'assistant' is unchanged. The backend
-- maps 'chat user' back to 'user' when serving messages, so the UI/LLM still use
-- the standard roles.

ALTER TABLE public."AI_CHAT_MESSAGES" DROP CONSTRAINT IF EXISTS ai_chat_messages_role_check;
UPDATE public."AI_CHAT_MESSAGES" SET role = 'chat user' WHERE role = 'user';
ALTER TABLE public."AI_CHAT_MESSAGES"
  ADD CONSTRAINT ai_chat_messages_role_check CHECK (role IN ('chat user', 'assistant'));
