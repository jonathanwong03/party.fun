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
};
