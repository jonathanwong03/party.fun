// Hybrid event retrieval: Postgres full-text (exact names, proper nouns) fused with
// vector similarity (meaning) via RRF in the match_events_hybrid RPC. Shared by the
// agent's tools, the /events/search endpoint and the AI recommend endpoint so all three
// rank identically.
//
// Degrades on two axes:
//   * no embedding (key off, or the event isn't backfilled) -> keyword-only, still useful
//   * hybrid RPC missing (migration not applied yet)        -> vector-only match_events

import { embedText, toVectorLiteral, isEmbeddingEnabled } from './embeddingService.js';

// Returns [{ eventId, similarity, score }] best-first, or [] when nothing matches.
// `similarity` is the true COSINE value (null for a keyword-only hit) — callers gate
// confidence on it. `score` is the RRF fusion value and only drives ordering.
export async function matchEventsHybrid(sb, query, { count = 40, exclude = null } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const vec = isEmbeddingEnabled() ? await embedText(q, { taskType: 'RETRIEVAL_QUERY' }) : null;
  const embedding = vec ? toVectorLiteral(vec) : null;

  const { data, error } = await sb.rpc('match_events_hybrid', {
    p_query: q, p_embedding: embedding, p_count: count, p_exclude: exclude,
  });
  if (!error) {
    return (data ?? []).map((r) => ({ eventId: r.eventId, similarity: r.similarity, score: r.score }));
  }

  // Hybrid RPC unavailable → vector-only, exactly as before. With no embedding there is
  // nothing left to rank on, so return empty rather than calling match_events with null.
  if (!embedding) return [];
  const legacy = await sb.rpc('match_events', { p_embedding: embedding, p_count: count, p_exclude: exclude });
  if (legacy.error) return [];
  return (legacy.data ?? []).map((r) => ({ eventId: r.eventId, similarity: r.similarity }));
}
