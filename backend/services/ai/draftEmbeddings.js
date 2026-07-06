import { createHash } from 'crypto';
import { embedText, toVectorLiteral, isEmbeddingEnabled } from './embeddingService.js';

function priceLine(statuses = []) {
  if (!Array.isArray(statuses)) return '';
  return statuses
    .map((s) => [s.statusName, s.price, s.qty ?? s.ticketCapacity].filter((v) => v !== undefined && v !== null && v !== '').join(' '))
    .filter(Boolean)
    .join('\n');
}

export function draftEmbeddingText(draft = {}) {
  return [
    draft.title,
    draft.description,
    draft.location ?? draft.venue,
    draft.address,
    draft.date ?? draft.startDate ?? draft.startsAt,
    draft.endDate ?? draft.endsAt,
    draft.pricingModel,
    draft.capacity ?? draft.maxCapacity,
    draft.hypeThreshold,
    priceLine(draft.statuses),
  ]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

export function draftEmbeddingHash(draft = {}) {
  return createHash('sha1').update(draftEmbeddingText(draft)).digest('hex');
}

export async function syncDraftEmbedding(sb, draftId, userId, draft) {
  try {
    if (!draftId || !userId || !isEmbeddingEnabled()) return;
    const text = draftEmbeddingText(draft);
    if (!text) return;
    const vec = await embedText(text, { taskType: 'RETRIEVAL_DOCUMENT' });
    if (!vec) return;
    await sb.from('EVENT_DRAFT_EMBEDDINGS').upsert({
      draft_id: draftId,
      user_id: userId,
      embedding: toVectorLiteral(vec),
      source_hash: draftEmbeddingHash(draft),
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[draftEmbeddings] sync failed:', err?.message || err);
  }
}

export async function deleteDraftEmbedding(sb, draftId) {
  try {
    if (!draftId) return;
    await sb.from('EVENT_DRAFT_EMBEDDINGS').delete().eq('draft_id', draftId);
  } catch (err) {
    console.warn('[draftEmbeddings] delete failed:', err?.message || err);
  }
}

export async function semanticDraftMatches(sb, query, drafts = [], count = 5) {
  const q = String(query ?? '').trim();
  if (!q || !isEmbeddingEnabled() || !drafts.length) return [];
  const vec = await embedText(q, { taskType: 'RETRIEVAL_QUERY' });
  if (!vec) return [];
  try {
    const { data, error } = await sb.rpc('match_event_drafts', { p_embedding: toVectorLiteral(vec), p_count: count });
    if (error || !data?.length) return [];
    const byId = new Map(drafts.map((d) => [String(d.id), d]));
    return data
      .filter((r) => byId.has(String(r.draftId)))
      .map((r) => ({ draft: byId.get(String(r.draftId)), similarity: Number(r.similarity ?? 0) }));
  } catch {
    return [];
  }
}
