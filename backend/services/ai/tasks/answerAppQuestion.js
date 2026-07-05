import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runTier } from '../modelRouter.js';

// Load the curated knowledge base once at module init.
const here = dirname(fileURLToPath(import.meta.url));
let KNOWLEDGE = '';
try {
  KNOWLEDGE = readFileSync(join(here, '..', 'app-knowledge.md'), 'utf8');
} catch {
  KNOWLEDGE = '';
}

function buildSystem() {
  return [
    'You are the party.fun help assistant. Answer questions about how the app works,',
    'using ONLY the reference below. If the answer is not covered, say you are not sure and',
    'suggest contacting the event organiser or support. Be concise and friendly.',
    '',
    '--- party.fun reference ---',
    KNOWLEDGE,
  ].join('\n');
}

// App Q&A (cheap tier). `history` is an optional short list of {role, content}.
export async function answerAppQuestion({ question = '', history = [] } = {}) {
  const messages = [
    ...history.slice(-6).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') })),
    { role: 'user', content: question },
  ];
  const res = await runTier('cheap', { system: buildSystem(), messages, maxTokens: 700 });
  if (!res) return { available: false };
  return { available: true, answer: res.text.trim(), provider: res.provider, model: res.model };
}

export { buildSystem as buildKnowledgeSystem };
