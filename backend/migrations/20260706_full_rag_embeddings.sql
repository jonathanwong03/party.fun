-- Full RAG expansion: semantic chat-history recall and semantic draft lookup.
-- Reuses the existing pgvector setup from 20260705_vector_embeddings.sql.

create extension if not exists vector;

-- Chat-message embeddings for non-authoritative long-term conversation recall.
alter table public."AI_CHAT_MESSAGES" add column if not exists embedding vector(768);
create index if not exists ai_chat_messages_embedding_hnsw
  on public."AI_CHAT_MESSAGES" using hnsw (embedding vector_cosine_ops);

drop policy if exists "ai_chat own embedding update" on public."AI_CHAT_MESSAGES";
create policy "ai_chat own embedding update" on public."AI_CHAT_MESSAGES"
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant update (embedding) on public."AI_CHAT_MESSAGES" to authenticated;
grant select, update (embedding) on public."AI_CHAT_MESSAGES" to service_role;

create or replace function public.match_chat_messages(p_embedding text, p_count int default 8)
returns setof json language sql stable security definer set search_path=public as $$
  select json_build_object(
    'id', id,
    'role', role,
    'content', content,
    'conversationId', conversation_id,
    'createdAt', created_at,
    'similarity', 1 - (embedding <=> p_embedding::vector)
  )
  from public."AI_CHAT_MESSAGES"
  where user_id = (select auth.uid()) and embedding is not null
  order by embedding <=> p_embedding::vector
  limit greatest(coalesce(p_count, 8), 1);
$$;

revoke execute on function public.match_chat_messages(text, int) from public, anon;
grant execute on function public.match_chat_messages(text, int) to authenticated;
grant execute on function public.match_chat_messages(text, int) to service_role;

-- Draft embeddings let the agent resolve natural draft references such as
-- "the networking draft" without exposing draft ids to the user.
create table if not exists public."EVENT_DRAFT_EMBEDDINGS" (
  draft_id text primary key,
  user_id uuid not null references public."USER"(id) on delete cascade,
  embedding vector(768),
  source_hash text,
  updated_at timestamptz not null default now()
);

create index if not exists event_draft_embeddings_user_hnsw
  on public."EVENT_DRAFT_EMBEDDINGS" using hnsw (embedding vector_cosine_ops);

alter table public."EVENT_DRAFT_EMBEDDINGS" enable row level security;

drop policy if exists "draft_emb own select" on public."EVENT_DRAFT_EMBEDDINGS";
create policy "draft_emb own select" on public."EVENT_DRAFT_EMBEDDINGS"
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "draft_emb own insert" on public."EVENT_DRAFT_EMBEDDINGS";
create policy "draft_emb own insert" on public."EVENT_DRAFT_EMBEDDINGS"
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "draft_emb own update" on public."EVENT_DRAFT_EMBEDDINGS";
create policy "draft_emb own update" on public."EVENT_DRAFT_EMBEDDINGS"
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "draft_emb own delete" on public."EVENT_DRAFT_EMBEDDINGS";
create policy "draft_emb own delete" on public."EVENT_DRAFT_EMBEDDINGS"
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public."EVENT_DRAFT_EMBEDDINGS" from public, anon;
grant select, insert, update, delete on public."EVENT_DRAFT_EMBEDDINGS" to authenticated;
grant select, insert, update, delete on public."EVENT_DRAFT_EMBEDDINGS" to service_role;

create or replace function public.match_event_drafts(p_embedding text, p_count int default 5)
returns setof json language sql stable security definer set search_path=public as $$
  select json_build_object(
    'draftId', draft_id,
    'similarity', 1 - (embedding <=> p_embedding::vector)
  )
  from public."EVENT_DRAFT_EMBEDDINGS"
  where user_id = (select auth.uid()) and embedding is not null
  order by embedding <=> p_embedding::vector
  limit greatest(coalesce(p_count, 5), 1);
$$;

revoke execute on function public.match_event_drafts(text, int) from public, anon;
grant execute on function public.match_event_drafts(text, int) to authenticated;
grant execute on function public.match_event_drafts(text, int) to service_role;
