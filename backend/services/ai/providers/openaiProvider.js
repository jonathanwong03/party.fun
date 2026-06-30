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
};
