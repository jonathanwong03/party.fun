// Per-user agent memory: durable preferences the agent learns and reads back to
// personalise. Reads/writes are scoped to one user — the chat passes the caller's
// RLS client; the advisor passes the service-role client + an explicit userId.

import { embedText, toVectorLiteral, isEmbeddingEnabled } from './embeddingService.js';

const CAP = 40;

export async function loadMemory(sb, userId) {
  let q = sb.from('AI_USER_MEMORY').select('id, content, category, created_at').order('created_at', { ascending: false }).limit(CAP);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) { console.warn('[ai memory] load failed:', error.message); return []; }
  return (data ?? []).map((m) => ({ id: m.id, content: m.content, category: m.category }));
}

// Save a learned fact. Explicitly sets user_id (the advisor's service client has no
// auth.uid()). De-dupes on identical content and prunes to the newest CAP rows.
export async function rememberFact(sb, userId, { content, category }) {
  const text = String(content ?? '').trim();
  if (!text) return { skipped: true };

  const existing = await loadMemory(sb, userId);
  if (existing.some((m) => m.content.toLowerCase() === text.toLowerCase())) return { duplicate: true };

  const stored = text.slice(0, 300);
  const { data: inserted, error } = await sb.from('AI_USER_MEMORY').insert({ user_id: userId, content: stored, category: category ?? null }).select('id').single();
  if (error) { console.warn('[ai memory] insert failed:', error.message); return { error: error.message }; }

  // Embed the fact so it can be recalled by relevance (fire-and-forget).
  embedMemory(sb, inserted?.id, stored).catch(() => {});

  // Prune anything beyond the cap (oldest first).
  if (existing.length + 1 > CAP) {
    const overflow = existing.slice(CAP - 1).map((m) => m.id);
    if (overflow.length) await sb.from('AI_USER_MEMORY').delete().in('id', overflow);
  }
  return { status: 'ok' };
}

// Store an embedding for one memory row (used on save + by the backfill). No-op
// without a key; never throws.
export async function embedMemory(sb, id, content) {
  if (!id || !isEmbeddingEnabled()) return;
  const vec = await embedText(content, { taskType: 'RETRIEVAL_DOCUMENT' });
  if (!vec) return;
  await sb.from('AI_USER_MEMORY').update({ embedding: toVectorLiteral(vec) }).eq('id', id);
}

// Recall the memories most RELEVANT to the current turn (vector match), instead of
// dumping all of them into the prompt. Falls back to loadMemory (all) when
// embeddings are off, the query is empty, or nothing matches.
export async function loadRelevantMemory(sb, userId, query, k = 8) {
  const q = String(query ?? '').trim();
  if (!q || !isEmbeddingEnabled()) return loadMemory(sb, userId);
  const vec = await embedText(q, { taskType: 'RETRIEVAL_QUERY' });
  if (!vec) return loadMemory(sb, userId);
  try {
    const { data, error } = await sb.rpc('match_user_memory', { p_embedding: toVectorLiteral(vec), p_count: k });
    if (error || !data?.length) return loadMemory(sb, userId);
    return data.map((m) => ({ id: m.id, content: m.content, category: m.category }));
  } catch {
    return loadMemory(sb, userId);
  }
}

// Compact block for the system prompt (empty string when there's nothing yet).
export function formatMemory(rows) {
  if (!rows?.length) return '';
  const lines = rows.map((m) => `- ${m.content}${m.category ? ` (${m.category})` : ''}`).join('\n');
  return `What you remember about this user (use it to personalise your help):\n${lines}`;
}
