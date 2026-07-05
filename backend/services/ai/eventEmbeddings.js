import { createHash } from 'crypto';
import { embedText, toVectorLiteral, isEmbeddingEnabled } from './embeddingService.js';

// The text we embed for an event (semantic content a buyer cares about).
export function eventEmbeddingText(e = {}) {
  return [e.title, e.description, e.location ?? e.venue, e.address]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

export function eventEmbeddingHash(e = {}) {
  return createHash('sha1').update(eventEmbeddingText(e)).digest('hex');
}

// Embed an event and upsert its vector. Fire-and-forget from create/update — never
// throws, never blocks the write, and no-ops when embeddings aren't configured.
export async function syncEventEmbedding(sb, eventId, e) {
  try {
    if (!eventId || !isEmbeddingEnabled()) return;
    const text = eventEmbeddingText(e);
    if (!text) return;
    const vec = await embedText(text, { taskType: 'RETRIEVAL_DOCUMENT' });
    if (!vec) return;
    await sb.rpc('upsert_event_embedding', {
      p_event_id: eventId,
      p_embedding: toVectorLiteral(vec),
      p_hash: eventEmbeddingHash(e),
    });
  } catch (err) {
    console.warn('[eventEmbeddings] sync failed:', err?.message || err);
  }
}
