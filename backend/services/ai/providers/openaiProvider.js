import { ProviderUnavailable, ProviderRefusal } from './base.js';

// OpenAI (GPT) adapter. SDK imported lazily. Model IDs are env-configured — confirm
// the current catalog (and whether the chosen model wants `max_tokens` vs
// `max_completion_tokens`) before relying on the defaults in modelRouter.js.
const apiKey = () => process.env.OPENAI_API_KEY;

export const openaiProvider = {
  name: 'openai',

  isConfigured() {
    return !!apiKey();
  },

  async generate({ system, messages, jsonSchema, model, maxTokens = 1024 }) {
    if (!this.isConfigured()) throw new ProviderUnavailable('openai');
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: apiKey() });

    const msgs = [];
    if (system) msgs.push({ role: 'system', content: system });
    for (const m of messages ?? []) msgs.push({ role: m.role, content: m.content });

    const req = { model, messages: msgs, max_tokens: maxTokens };
    if (jsonSchema) {
      req.response_format = {
        type: 'json_schema',
        json_schema: { name: 'result', schema: jsonSchema, strict: true },
      };
    }

    const resp = await client.chat.completions.create(req);
    const choice = resp.choices?.[0];
    if (choice?.finish_reason === 'content_filter') throw new ProviderRefusal('openai');
    const text = choice?.message?.content ?? '';
    return { text, provider: 'openai', model };
  },

  // Tool-use turn for the agent loop.
  async chatWithTools({ system, messages, tools, model, maxTokens = 1024 }) {
    if (!this.isConfigured()) throw new ProviderUnavailable('openai');
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: apiKey() });

    const msgs = [];
    if (system) msgs.push({ role: 'system', content: system });
    for (const m of messages ?? []) {
      if (m.role === 'tool') {
        msgs.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      } else if (m.role === 'assistant') {
        const msg = { role: 'assistant', content: m.content || null };
        if (m.toolCalls?.length) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
          }));
        }
        msgs.push(msg);
      } else {
        msgs.push({ role: 'user', content: m.content });
      }
    }

    const req = {
      model,
      messages: msgs,
      max_tokens: maxTokens,
      tools: (tools ?? []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    };

    const resp = await client.chat.completions.create(req);
    const choice = resp.choices?.[0];
    if (choice?.finish_reason === 'content_filter') throw new ProviderRefusal('openai');
    const text = choice?.message?.content ?? '';
    const toolCalls = (choice?.message?.tool_calls ?? [])
      .filter((c) => c.type === 'function')
      .map((c) => {
        let args = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch { args = {}; }
        return { id: c.id, name: c.function.name, args };
      });
    return { text, toolCalls, provider: 'openai', model };
  },
};
