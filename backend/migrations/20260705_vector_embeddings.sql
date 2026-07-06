-- Vector-embedding RAG: pgvector store for event + doc embeddings, and match RPCs.
-- Vectors are passed in as a '[..]' text literal and cast to `vector` (reliable via PostgREST).

create extension if not exists vector;

-- ── Event embeddings (one per event) ────────────────────────────────────────
create table if not exists public."EVENT_EMBEDDINGS" (
  event_id   uuid primary key references public."EVENT"(id) on delete cascade,
  embedding  vector(768),
  source_hash text,
  updated_at timestamptz default now()
);
create index if not exists event_embeddings_hnsw
  on public."EVENT_EMBEDDINGS" using hnsw (embedding vector_cosine_ops);

-- ── Help/FAQ doc chunks (for answerAppQuestion RAG) ──────────────────────────
create table if not exists public."DOC_CHUNKS" (
  id        bigserial primary key,
  source    text,
  chunk     text,
  embedding vector(768)
);
create index if not exists doc_chunks_hnsw
  on public."DOC_CHUNKS" using hnsw (embedding vector_cosine_ops);

-- ── RLS: readable by authenticated; writes only via the SECURITY DEFINER RPC ─
alter table public."EVENT_EMBEDDINGS" enable row level security;
alter table public."DOC_CHUNKS" enable row level security;
drop policy if exists event_emb_read on public."EVENT_EMBEDDINGS";
create policy event_emb_read on public."EVENT_EMBEDDINGS" for select to authenticated using (true);
drop policy if exists doc_chunks_read on public."DOC_CHUNKS";
create policy doc_chunks_read on public."DOC_CHUNKS" for select to authenticated using (true);

-- Upsert an event's embedding — the event's manager (owner/co-organiser) or the
-- service role (backfill) only.
create or replace function public.upsert_event_embedding(p_event_id uuid, p_embedding text, p_hash text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role() <> 'service_role' and not public.can_manage_event(p_event_id, auth.uid()) then
    raise exception 'not_authorized';
  end if;
  insert into public."EVENT_EMBEDDINGS"(event_id, embedding, source_hash, updated_at)
  values (p_event_id, p_embedding::vector, p_hash, now())
  on conflict (event_id) do update
    set embedding = excluded.embedding, source_hash = excluded.source_hash, updated_at = now();
end; $$;

-- Rank events by cosine similarity to a query vector. Coarse: excludes only
-- cancelled/completed; the app layer applies the finer "attendable" filter.
create or replace function public.match_events(p_embedding text, p_count int default 10, p_exclude uuid default null)
returns setof json language sql stable security definer set search_path=public as $$
  select json_build_object('eventId', e.id::text, 'similarity', 1 - (em.embedding <=> p_embedding::vector))
  from public."EVENT_EMBEDDINGS" em
  join public."EVENT" e on e.id = em.event_id
  where e.status not in ('cancelled','completed')
    and (p_exclude is null or e.id <> p_exclude)
  order by em.embedding <=> p_embedding::vector
  limit greatest(coalesce(p_count, 10), 1);
$$;

create or replace function public.match_doc_chunks(p_embedding text, p_count int default 4)
returns setof json language sql stable security definer set search_path=public as $$
  select json_build_object('source', source, 'chunk', chunk, 'similarity', 1 - (embedding <=> p_embedding::vector))
  from public."DOC_CHUNKS"
  order by embedding <=> p_embedding::vector
  limit greatest(coalesce(p_count, 4), 1);
$$;

revoke execute on function public.upsert_event_embedding(uuid, text, text) from public, anon;
grant execute on function public.upsert_event_embedding(uuid, text, text) to authenticated, service_role;
grant execute on function public.match_events(text, int, uuid) to authenticated, service_role;
grant execute on function public.match_doc_chunks(text, int) to authenticated, service_role;
