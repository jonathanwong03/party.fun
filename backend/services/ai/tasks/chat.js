import { runTier } from '../modelRouter.js';
import { buildKnowledgeSystem } from './answerAppQuestion.js';

// General assistant for the floating chat panel. Routes to the premium tier and
// answers from the app knowledge base. (Event recommendations are a separate
// endpoint the UI can call; v1 chat stays a single grounded Q&A call.)
export async function chat({ messages = [] } = {}) {
  const system = [
    buildKnowledgeSystem(),
    '',
    'You are also an upbeat event-planning companion: help organisers brainstorm event ideas, names,',
    'and ways to boost attendance, and help students find events. Keep replies short and practical.',
  ].join('\n');

  const normalised = messages
    .slice(-12)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') }))
    .filter((m) => m.content.trim());
  if (!normalised.length) return { available: true, reply: 'Hi! Ask me anything about planning or finding events on party.fun.' };

  const res = await runTier('premium', { system, messages: normalised, maxTokens: 900 });
  if (!res) return { available: false };
  return { available: true, reply: res.text.trim(), provider: res.provider, model: res.model };
}
