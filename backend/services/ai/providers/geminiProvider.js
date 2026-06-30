import { ProviderUnavailable } from './base.js';

// Google Gemini adapter via @google/genai. SDK imported lazily. We request JSON
// via responseMimeType (the task parses defensively); we deliberately do NOT
// translate the JSON Schema into Gemini's Schema type to keep the adapter simple
// and provider-agnostic — the prompt instructs the shape and parseJson handles it.
// Require an explicit GEMINI_API_KEY so an unrelated GOOGLE_API_KEY (e.g. from a
// local gcloud setup) doesn't accidentally activate this provider.
const apiKey = () => process.env.GEMINI_API_KEY;

export const geminiProvider = {
  name: 'gemini',

  isConfigured() {
    return !!apiKey();
  },

  async generate({ system, messages, jsonSchema, model, maxTokens = 1024 }) {
    if (!this.isConfigured()) throw new ProviderUnavailable('gemini');
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: apiKey() });

    const contents = (messages ?? []).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const config = { maxOutputTokens: maxTokens };
    if (system) config.systemInstruction = system;
    if (jsonSchema) config.responseMimeType = 'application/json';

    const resp = await ai.models.generateContent({ model, contents, config });
    const text = typeof resp.text === 'function' ? resp.text() : (resp.text ?? '');
    return { text, provider: 'gemini', model };
  },

  // Tool-use turn for the agent loop. Gemini matches tool results by function
  // name (no call ids), so we synthesise ids only for our loop bookkeeping.
  async chatWithTools({ system, messages, tools, model, maxTokens = 1024 }) {
    if (!this.isConfigured()) throw new ProviderUnavailable('gemini');
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: apiKey() });

    const contents = [];
    for (const m of messages ?? []) {
      if (m.role === 'tool') {
        const part = { functionResponse: { name: m.name, response: { result: m.content } } };
        const last = contents[contents.length - 1];
        if (last && last.role === 'user' && last.parts[0]?.functionResponse) last.parts.push(part);
        else contents.push({ role: 'user', parts: [part] });
      } else if (m.role === 'assistant') {
        const parts = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls ?? []) parts.push({ functionCall: { name: tc.name, args: tc.args ?? {} } });
        contents.push({ role: 'model', parts });
      } else {
        contents.push({ role: 'user', parts: [{ text: m.content }] });
      }
    }

    const config = { maxOutputTokens: maxTokens };
    if (system) config.systemInstruction = system;
    if (tools?.length) {
      config.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }

    const resp = await ai.models.generateContent({ model, contents, config });
    const text = typeof resp.text === 'function' ? resp.text() : (resp.text ?? '');
    const calls = typeof resp.functionCalls === 'function' ? resp.functionCalls() : (resp.functionCalls ?? []);
    const toolCalls = (calls ?? []).map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.name, args: c.args ?? {} }));
    return { text: text ?? '', toolCalls, provider: 'gemini', model };
  },
};
