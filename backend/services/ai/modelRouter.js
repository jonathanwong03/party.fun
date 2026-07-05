import { geminiProvider } from './providers/geminiProvider.js';

// Gemini-only router. Each cost tier resolves to a single {provider, model}
// candidate; the tier helpers keep their ordered-list shape (a list of one) so
// the generic runners and the LangGraph model builder stay unchanged. The model
// ID comes from env with a default (gemini-2.5-flash).

const PROVIDERS = {
  gemini: geminiProvider,
};

// Test seam: tests swap in mock providers via __setProvidersForTests.
export const dependencies = { providers: PROVIDERS };
export function __setProvidersForTests(p) { dependencies.providers = p; }
export function __resetProvidersForTests() { dependencies.providers = PROVIDERS; }

const env = (name, fallback) => process.env[name] || fallback;

// One Gemini Flash model drives every tier. `gemini-2.5-flash` is stable (far fewer
// 503s than flash-lite) and cheap with billing enabled. Override with AI_GEMINI_MODEL.
function tierConfig() {
  const model = env('AI_GEMINI_MODEL', 'gemini-2.5-flash');
  return {
    cheap: [{ provider: 'gemini', model }],
    premium: [{ provider: 'gemini', model }],
  };
}

// True if at least one provider has an API key — the controller uses this to
// return {available:false} (a 200, not a 500) so the UI hides AI features.
export function anyConfigured() {
  return Object.values(dependencies.providers).some((p) => p?.isConfigured?.());
}

// Ordered candidate list for a tier: the user-picked {provider, model} first (if
// configured), then the tier's other configured providers — enabling auto-fallback.
export function resolveCandidates(tier, preferred) {
  const base = (tierConfig()[tier] ?? []).filter((c) => dependencies.providers[c.provider]?.isConfigured?.());
  if (!preferred?.provider || !preferred?.model) return base;
  if (!dependencies.providers[preferred.provider]?.isConfigured?.()) return base;
  const rest = base.filter((c) => !(c.provider === preferred.provider && c.model === preferred.model));
  return [{ provider: preferred.provider, model: preferred.model }, ...rest];
}

// Run a tool-capable turn over an ordered candidate list (preferred-first), with
// fallback. Returns the first provider's normalised {text, toolCalls, ...} or null.
export async function runChat(candidates, { system, messages, tools, maxTokens }) {
  const errors = [];
  for (const { provider, model } of candidates) {
    const impl = dependencies.providers[provider];
    if (!impl?.isConfigured?.() || typeof impl.chatWithTools !== 'function') continue;
    try {
      return await impl.chatWithTools({ system, messages, tools, model, maxTokens });
    } catch (e) {
      errors.push(`${provider}: ${e?.message || e}`);
    }
  }
  if (errors.length) console.warn('[modelRouter] runChat exhausted:', errors.join(' | '));
  return null;
}

// Try each candidate in the tier; return the first successful generation, or
// null if none are configured or all fail. Never throws.
export async function runTier(tier, { system, messages, jsonSchema, maxTokens }) {
  const candidates = tierConfig()[tier] ?? [];
  const errors = [];
  for (const { provider, model } of candidates) {
    const impl = dependencies.providers[provider];
    if (!impl || !impl.isConfigured?.()) continue;
    try {
      const result = await impl.generate({ system, messages, jsonSchema, model, maxTokens });
      if (result && typeof result.text === 'string' && result.text.trim()) return result;
      errors.push(`${provider}: empty response`);
    } catch (e) {
      errors.push(`${provider}: ${e?.message || e}`);
    }
  }
  if (errors.length) console.warn(`[modelRouter] tier "${tier}" exhausted:`, errors.join(' | '));
  return null;
}
