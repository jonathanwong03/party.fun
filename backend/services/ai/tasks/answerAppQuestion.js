import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runTier } from '../modelRouter.js';
import { embedText, toVectorLiteral, isEmbeddingEnabled } from '../embeddingService.js';

// Load the curated knowledge base once at module init.
const here = dirname(fileURLToPath(import.meta.url));
let KNOWLEDGE = '';
try {
  KNOWLEDGE = readFileSync(join(here, '..', 'app-knowledge.md'), 'utf8');
} catch {
  KNOWLEDGE = '';
}

function buildSystem(reference = KNOWLEDGE) {
  return [
    'You are the party.fun help assistant. Answer questions about how the app works,',
    'using ONLY the reference below. If the answer is not covered, say you are not sure and',
    'suggest contacting the event organiser or support. Be concise and friendly.',
    '',
    '--- party.fun reference ---',
    reference,
  ].join('\n');
}

// Vector RAG: retrieve only the most relevant knowledge chunks for the question
// (via DOC_CHUNKS + match_doc_chunks). Returns null when embeddings/chunks are
// unavailable so we fall back to injecting the whole doc.
async function retrieveKnowledge(sb, question) {
  if (!sb || !isEmbeddingEnabled()) return null;
  const vec = await embedText(question, { taskType: 'RETRIEVAL_QUERY' });
  if (!vec) return null;
  try {
    const { data, error } = await sb.rpc('match_doc_chunks', { p_embedding: toVectorLiteral(vec), p_count: 4 });
    if (error || !data?.length) return null;
    return data.map((c) => c.chunk).join('\n\n');
  } catch {
    return null;
  }
}

// App Q&A (cheap tier). `history` is an optional short list of {role, content};
// `supabase` (when provided) enables chunk retrieval instead of the whole doc.
export async function answerAppQuestion({ question = '', history = [], supabase = null } = {}) {
  const reference = (await retrieveKnowledge(supabase, question)) ?? KNOWLEDGE;
  const messages = [
    ...history.slice(-6).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') })),
    { role: 'user', content: question },
  ];
  const res = await runTier('cheap', { system: buildSystem(reference), messages, maxTokens: 700 });
  if (!res) return { available: false };
  return { available: true, answer: res.text.trim(), provider: res.provider, model: res.model };
}

export { buildSystem as buildKnowledgeSystem };
