import { embedText, isEmbeddingEnabled } from './embeddingService.js';
import { getAppKnowledge } from './tasks/answerAppQuestion.js';

// In-memory document RAG over app-knowledge.md.
//
// The file is the single AUTHORED source of truth; this index is a DERIVED artefact built FROM it
// and held only in RAM — nothing is persisted, so it can never drift. It is (re)built from the
// current file the first time a query needs it (and rebuilt from scratch on every process start).
//
// Pipeline (the classic RAG loop): split the doc into "## "-section chunks -> embed each chunk ->
// embed the question -> cosine-rank -> return the top-K chunks. Callers fall back to the whole doc
// when embeddings are unavailable, so an answer path always exists.

// Split the knowledge base into chunks at each "## " section header.
export function chunkDoc(md) {
  return String(md || '').split(/\n(?=##\s)/).map((s) => s.trim()).filter(Boolean);
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Memoised index build (once per process). Resolves to an array of { chunk, vector }, or null if
// embeddings are off or any chunk failed to embed (→ callers use the whole-doc fallback).
let indexPromise = null;
async function buildIndex() {
  if (!isEmbeddingEnabled()) return null;
  const chunks = chunkDoc(getAppKnowledge());
  if (!chunks.length) return null;
  const entries = [];
  for (const chunk of chunks) {
    const vector = await embedText(chunk, { taskType: 'RETRIEVAL_DOCUMENT' });
    if (!vector) return null; // partial index is worse than the whole-doc fallback
    entries.push({ chunk, vector });
  }
  return entries;
}
function getIndex() {
  if (!indexPromise) indexPromise = buildIndex().catch(() => null);
  return indexPromise;
}

// Retrieve the top-K most relevant chunks for a question, joined into one reference string.
// Returns null when retrieval is unavailable (no key / no vector) so the caller falls back to the
// whole doc. Never throws.
export async function retrieveDocChunks(question, k = 4) {
  const q = String(question || '').trim();
  if (!q || !isEmbeddingEnabled()) return null;
  const index = await getIndex();
  if (!index || !index.length) return null;
  const qVec = await embedText(q, { taskType: 'RETRIEVAL_QUERY' });
  if (!qVec) return null;
  const ranked = index
    .map((e) => ({ chunk: e.chunk, score: cosineSim(qVec, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return ranked.map((r) => r.chunk).join('\n\n');
}

// Test seam: drop the memoised index so a test can rebuild it with a fresh injected embedder.
export function __resetDocIndexForTests() {
  indexPromise = null;
}
