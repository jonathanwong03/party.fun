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
};
