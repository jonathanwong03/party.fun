-- Round 2 of vector RAG: per-user memory embeddings + similar-past-event benchmark.

-- ── Memory embeddings (for relevance-ranked recall) ─────────────────────────
alter table public."AI_USER_MEMORY" add column if not exists embedding vector(768);
create index if not exists ai_user_memory_hnsw
  on public."AI_USER_MEMORY" using hnsw (embedding vector_cosine_ops);

-- Top memories for the current user, by cosine similarity to a query vector.
create or replace function public.match_user_memory(p_embedding text, p_count int default 8)
returns setof json language sql stable security definer set search_path=public as $$
  select json_build_object('id', id, 'content', content, 'category', category,
                           'similarity', 1 - (embedding <=> p_embedding::vector))
  from public."AI_USER_MEMORY"
  where user_id = auth.uid() and embedding is not null
  order by embedding <=> p_embedding::vector
  limit greatest(coalesce(p_count, 8), 1);
$$;

-- Completed/past events most similar to a query vector, with their real sell-through
-- (tickets sold vs capacity) — a benchmark for the revenue forecast.
create or replace function public.match_similar_past_events(p_embedding text, p_count int default 5, p_exclude uuid default null)
returns setof json language sql stable security definer set search_path=public as $$
  select json_build_object(
    'eventId', e.id::text, 'title', e.title,
    'sold', (select count(*)::int from public."TICKETS" t join public."BOOKINGS" b on b.id = t."bookingId"
             where b."eventId" = e.id and t.status in ('active','used') and b."deletedAt" is null),
    'capacity', coalesce(es."maxCapacity", 0),
    'similarity', 1 - (em.embedding <=> p_embedding::vector))
  from public."EVENT_EMBEDDINGS" em
  join public."EVENT" e on e.id = em.event_id
  join public."EVENT_SETTINGS" es on es."eventId" = e.id
  where (e.status = 'completed' or e."endDate" < now())
    and (p_exclude is null or e.id <> p_exclude)
  order by em.embedding <=> p_embedding::vector
  limit greatest(coalesce(p_count, 5), 1);
$$;

grant execute on function public.match_user_memory(text, int) to authenticated, service_role;
grant execute on function public.match_similar_past_events(text, int, uuid) to authenticated, service_role;
