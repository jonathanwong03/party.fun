// Gemini text embeddings for the vector-RAG features (event recommendation,
// semantic search, similar events, help-doc retrieval). Returns 768-dim vectors.
// Everything degrades gracefully to null when GEMINI_API_KEY is unset so callers
// can fall back to their previous (LLM / substring) behaviour.

const apiKey = () => process.env.GEMINI_API_KEY;
const MODEL = () => process.env.AI_EMBED_MODEL || 'gemini-embedding-001';
export const EMBED_DIMS = 768;

// taskType: 'RETRIEVAL_DOCUMENT' for stored items (events, doc chunks),
// 'RETRIEVAL_QUERY' for the search/interest query.
async function defaultEmbed(text, taskType) {
  if (!apiKey()) return null;
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: apiKey() });
  const resp = await ai.models.embedContent({
    model: MODEL(),
    contents: text,
    config: { outputDimensionality: EMBED_DIMS, taskType },
  });
  const values = resp?.embeddings?.[0]?.values ?? resp?.embedding?.values ?? null;
  return Array.isArray(values) && values.length ? values : null;
}

// Test seam: inject a deterministic embedder so tests never hit the network.
export const dependencies = { embed: defaultEmbed };
export function __setEmbedForTests(fn) { dependencies.embed = fn; }
export function __resetEmbedForTests() { dependencies.embed = defaultEmbed; }

export function isEmbeddingEnabled() {
  return !!apiKey();
}

// Embed one string → number[] (or null on failure / no key). Never throws.
export async function embedText(text, { taskType = 'RETRIEVAL_DOCUMENT' } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  try {
    return await dependencies.embed(t.slice(0, 8000), taskType);
  } catch (e) {
    console.warn('[embeddingService] embed failed:', e?.message || e);
    return null;
  }
}

// A pgvector text literal ('[0.1,0.2,…]') for passing an embedding to an RPC.
export function toVectorLiteral(arr) {
  return `[${(arr ?? []).map((n) => Number(n)).join(',')}]`;
}
