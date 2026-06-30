import { anthropicProvider } from './providers/anthropicProvider.js';
import { openaiProvider } from './providers/openaiProvider.js';
import { geminiProvider } from './providers/geminiProvider.js';

// Multi-provider router. Each cost tier has an ordered list of {provider, model}
// candidates; runTier tries them in order, skipping unconfigured providers and
// falling through on error/refusal. Model IDs come from env with documented
// defaults — Anthropic IDs are exact; OpenAI/Gemini IDs are placeholders to
// confirm against each provider's current catalog at wire-up time.

const PROVIDERS = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
};

// Test seam: tests swap in mock providers via __setProvidersForTests.
export const dependencies = { providers: PROVIDERS };
export function __setProvidersForTests(p) { dependencies.providers = p; }
export function __resetProvidersForTests() { dependencies.providers = PROVIDERS; }

const env = (name, fallback) => process.env[name] || fallback;

function tierConfig() {
  return {
    cheap: [
      { provider: 'anthropic', model: env('AI_ANTHROPIC_CHEAP', 'claude-haiku-4-5') },
      { provider: 'openai', model: env('AI_OPENAI_CHEAP', 'gpt-4o-mini') },
      { provider: 'gemini', model: env('AI_GEMINI_CHEAP', 'gemini-1.5-flash') },
    ],
    premium: [
      { provider: 'anthropic', model: env('AI_ANTHROPIC_PREMIUM', 'claude-opus-4-8') },
      { provider: 'openai', model: env('AI_OPENAI_PREMIUM', 'gpt-4o') },
      { provider: 'gemini', model: env('AI_GEMINI_PREMIUM', 'gemini-1.5-pro') },
    ],
  };
}

// True if at least one provider has an API key — the controller uses this to
// return {available:false} (a 200, not a 500) so the UI hides AI features.
export function anyConfigured() {
  return Object.values(dependencies.providers).some((p) => p?.isConfigured?.());
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
