import { ProviderUnavailable, ProviderRefusal } from './base.js';

// Anthropic (Claude) adapter. The SDK is imported lazily so the backend boots
// even when the package isn't installed or no key is set.
const apiKey = () => process.env.ANTHROPIC_API_KEY;

export const anthropicProvider = {
  name: 'anthropic',

  isConfigured() {
    return !!apiKey();
  },

  async generate({ system, messages, jsonSchema, model, maxTokens = 1024 }) {
    if (!this.isConfigured()) throw new ProviderUnavailable('anthropic');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: apiKey() });

    const req = {
      model,
      max_tokens: maxTokens,
      messages: (messages ?? []).map((m) => ({ role: m.role, content: m.content })),
    };
    if (system) req.system = system;
    // Native structured output (best effort; the task also parses defensively).
    if (jsonSchema) req.output_config = { format: { type: 'json_schema', schema: jsonSchema } };

    const resp = await client.messages.create(req);
    if (resp.stop_reason === 'refusal') throw new ProviderRefusal('anthropic');
    const text = (resp.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, provider: 'anthropic', model };
  },

  // Tool-use turn for the agent loop. Translates canonical messages/tools to the
  // Anthropic shape and returns { text, toolCalls:[{id,name,args}] }.
  async chatWithTools({ system, messages, tools, model, maxTokens = 1024 }) {
    if (!this.isConfigured()) throw new ProviderUnavailable('anthropic');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: apiKey() });

    // Coalesce consecutive canonical 'tool' turns into a single user message of
    // tool_result blocks (Anthropic requires all results for one assistant turn
    // together).
    const out = [];
    for (const m of messages ?? []) {
      if (m.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
        const last = out[out.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
          last.content.push(block);
        } else {
          out.push({ role: 'user', content: [block] });
        }
      } else if (m.role === 'assistant') {
        const content = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls ?? []) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
        out.push({ role: 'assistant', content });
      } else {
        out.push({ role: 'user', content: m.content });
      }
    }

    const req = {
      model,
      max_tokens: maxTokens,
      messages: out,
      tools: (tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    };
    if (system) req.system = system;

    const resp = await client.messages.create(req);
    if (resp.stop_reason === 'refusal') throw new ProviderRefusal('anthropic');
    const blocks = resp.content ?? [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const toolCalls = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
    return { text, toolCalls, provider: 'anthropic', model };
  },
};
