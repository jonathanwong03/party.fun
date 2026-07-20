-- ── Hybrid event search: Postgres full-text + vector, fused with RRF ─────────
-- Vector-only retrieval (match_events) has the classic semantic blind spot: cosine
-- similarity is weak on proper nouns and exact strings ("Springleaf prata", "Ulu
-- Pandan", a specific title). The agent papered over it with literal substring
-- matching before falling back to semantic. This adds the keyword half properly and
-- fuses the two rankings with Reciprocal Rank Fusion — all inside Postgres, no new
-- infrastructure.
--
-- match_events is deliberately LEFT IN PLACE: it stays the fallback the app uses when
-- this RPC isn't present yet (code can ship before this migration is applied).

-- ── 1. Keyword half: a self-maintaining tsvector on EVENT ────────────────────
-- A GENERATED column (not a trigger, not a second table) so it can never drift: Postgres
-- recomputes it on every write, and it is populated for every EXISTING row the moment the
-- column is added — so keyword search covers events that have no embedding yet.
-- Weighted so a title hit outranks a description/venue hit, which is exactly what we want
-- for name lookups.
alter table public."EVENT" add column if not exists "searchVector" tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(location, '') || ' ' || coalesce(address, '')), 'C')
  ) stored;

create index if not exists event_search_gin on public."EVENT" using gin ("searchVector");

-- ── 2. Hybrid match: RRF over (vector rank, keyword rank) ────────────────────
-- Either half may be empty and the function still works:
--   p_embedding null/absent  -> keyword-only (embeddings off, or not backfilled)
--   p_query blank            -> vector-only  (identical ranking to match_events)
--
-- IMPORTANT: `similarity` in the result is the true COSINE similarity (null for a
-- keyword-only hit), NOT the RRF score. Callers gate on it (resolveEvent requires
-- >= 0.55 with a 0.06 margin); RRF scores sit around 0.01-0.03 and would silently
-- break those thresholds. Ordering uses `score`; confidence uses `similarity`.
create or replace function public.match_events_hybrid(
  p_query text,
  p_embedding text default null,
  p_count int default 10,
  p_exclude uuid default null
)
returns setof json language sql stable security definer set search_path = public as $$
  with params as (
    select greatest(coalesce(p_count, 10), 1) as n,
           greatest(coalesce(p_count, 10) * 4, 50) as pool
  ),
  vec as (
    select em.event_id,
           row_number() over (order by em.embedding <=> p_embedding::vector) as rnk,
           1 - (em.embedding <=> p_embedding::vector) as sim
    from public."EVENT_EMBEDDINGS" em
    join public."EVENT" e on e.id = em.event_id
    where p_embedding is not null
      and e.status not in ('cancelled', 'completed')
      and (p_exclude is null or e.id <> p_exclude)
    order by em.embedding <=> p_embedding::vector
    limit (select pool from params)
  ),
  kw as (
    select e.id as event_id,
           row_number() over (order by ts_rank_cd(e."searchVector", q.tsq) desc) as rnk
    from public."EVENT" e,
         lateral (select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq) q
    where btrim(coalesce(p_query, '')) <> ''
      and q.tsq is not null
      and e."searchVector" @@ q.tsq
      and e.status not in ('cancelled', 'completed')
      and (p_exclude is null or e.id <> p_exclude)
    order by ts_rank_cd(e."searchVector", q.tsq) desc
    limit (select pool from params)
  ),
  fused as (
    select coalesce(v.event_id, k.event_id) as event_id,
           v.sim as similarity,
           -- Reciprocal Rank Fusion, k = 60 (the standard constant): a doc ranked well by
           -- either retriever scores; ranked well by BOTH scores highest.
           coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0) as score
    from vec v
    full outer join kw k on k.event_id = v.event_id
  )
  select json_build_object(
           'eventId', f.event_id::text,
           'similarity', f.similarity,
           'score', f.score
         )
  from fused f
  order by f.score desc, f.similarity desc nulls last
  limit (select n from params);
$$;

revoke execute on function public.match_events_hybrid(text, text, int, uuid) from public, anon;
grant execute on function public.match_events_hybrid(text, text, int, uuid) to authenticated, service_role;
