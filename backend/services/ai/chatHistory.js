import { embedText, toVectorLiteral, isEmbeddingEnabled } from './embeddingService.js';

// Chat history is useful context, not authority. Current app state must still
// come from tools/RPCs in the same turn.

export async function embedChatMessage(sb, id, content) {
  if (!id || !isEmbeddingEnabled()) return;
  const text = String(content ?? '').trim();
  if (!text) return;
  const vec = await embedText(text, { taskType: 'RETRIEVAL_DOCUMENT' });
  if (!vec) return;
  await sb.from('AI_CHAT_MESSAGES').update({ embedding: toVectorLiteral(vec) }).eq('id', id);
}

export function embedChatMessages(sb, rows = []) {
  for (const row of rows) {
    embedChatMessage(sb, row.id, row.content).catch((e) => {
      console.warn('[ai chat history] embed failed:', e?.message || e);
    });
  }
}

export async function loadRelevantChatHistory(sb, query, k = 6) {
  const q = String(query ?? '').trim();
  if (!q || !isEmbeddingEnabled()) return [];
  const vec = await embedText(q, { taskType: 'RETRIEVAL_QUERY' });
  if (!vec) return [];
  try {
    const { data, error } = await sb.rpc('match_chat_messages', { p_embedding: toVectorLiteral(vec), p_count: k });
    if (error || !data?.length) return [];
    return data
      .map((m) => ({
        role: m.role === 'chat user' ? 'user' : 'assistant',
        content: String(m.content ?? '').slice(0, 500),
      }))
      .filter((m) => m.content.trim());
  } catch {
    return [];
  }
}

export function formatChatHistory(rows = []) {
  if (!rows.length) return '';
  const lines = rows.map((m) => `${m.role}: ${m.content}`).join('\n');
  return [
    'Relevant earlier chat snippets (use only as non-authoritative context; call tools for current event, ticket, wallet, draft, and pricing state):',
    lines,
  ].join('\n');
}
