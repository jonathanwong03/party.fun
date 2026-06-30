import { resolveCandidates, runChat } from '../modelRouter.js';
import { TOOL_DEFS, executeTool } from './tools.js';

const MAX_STEPS = 5;

// Agentic chat loop: the model autonomously calls backend tools to research and
// answer. `ctx` = { supabase, userId, role }. `preferred` = optional {provider,
// model} from the UI toggle (preferred-first, then auto-fallback). Returns
// { available, reply, provider, model } or { available:false }.
export async function runAgent({ system, messages, ctx, preferred } = {}) {
  const candidates = resolveCandidates('premium', preferred);
  if (candidates.length === 0) return { available: false };

  // Canonical conversation we extend each step.
  const convo = (messages ?? [])
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') }))
    .filter((m) => m.content.trim());

  const proposals = []; // pending write actions awaiting user confirmation
  let last = null;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const res = await runChat(candidates, { system, messages: convo, tools: TOOL_DEFS, maxTokens: 1024 });
    if (!res) return { available: false };
    last = res;

    if (!res.toolCalls || res.toolCalls.length === 0) {
      return { available: true, reply: (res.text ?? '').trim(), proposals, provider: res.provider, model: res.model };
    }

    // Record the assistant's tool-call turn, execute each tool, append results.
    convo.push({ role: 'assistant', content: res.text ?? '', toolCalls: res.toolCalls });
    for (const tc of res.toolCalls) {
      const result = await executeTool(tc.name, tc.args, ctx);
      if (result && result.proposal) proposals.push(result.proposal);
      convo.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: JSON.stringify(result) });
    }
  }

  // Hit the step cap — return whatever text we have, or a graceful note.
  return {
    available: true,
    reply: (last?.text ?? '').trim() || "I gathered some info but couldn't finish — could you narrow that down?",
    proposals,
    provider: last?.provider,
    model: last?.model,
  };
}
