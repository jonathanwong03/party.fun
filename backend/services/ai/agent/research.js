// Web-research helper for event ideas. Uses Gemini's built-in Google Search
// grounding to find what university students are currently interested in, then
// proposes an event name, description, rationale and a location suggestion
// (favouring popular/convenient venues near the organiser's university). Degrades
// to plain model knowledge (via the router) when Gemini isn't configured or
// grounding fails. Never throws.

import { runTier } from '../modelRouter.js';

const geminiKey = () => process.env.GEMINI_API_KEY;
const RESEARCH_MODEL = () => process.env.AI_GEMINI_MODEL || 'gemini-2.5-flash-lite';

function buildPrompt({ theme, audience, university }) {
  const who = audience ? `university students (${audience})` : 'university students';
  const uni = university ? `near ${university}` : 'near a Singapore university';
  const themeLine = theme ? ` They are considering a "${theme}" angle.` : '';
  return `An event organiser wants to run an event for ${who} in Singapore.${themeLine}\n`
    + 'Find what such students are into RIGHT NOW, then propose ONE event concept.\n'
    + 'Respond with ONLY a JSON object (no prose, no markdown, no emojis) with keys: '
    + '"trends" (array of 3-5 short strings), "suggestedName" (string), '
    + '"suggestedDescription" (2-3 sentences), "rationale" (why it fits these students, 1-2 sentences), '
    + `"suggestedLocation" (a specific, popular, convenient venue or area ${uni}).`;
}

// Pull the first {...} JSON object out of a model reply (which may include cited prose).
function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalise(j) {
  return {
    trends: Array.isArray(j.trends) ? j.trends.slice(0, 6).map(String) : [],
    suggestedName: String(j.suggestedName ?? j.name ?? ''),
    suggestedDescription: String(j.suggestedDescription ?? j.description ?? ''),
    rationale: String(j.rationale ?? ''),
    suggestedLocation: String(j.suggestedLocation ?? j.location ?? ''),
  };
}

// Real web search via Gemini's built-in Google Search grounding. Throws when
// Gemini isn't configured (or grounding errors) so researchEventIdeas falls back
// to model knowledge.
async function defaultCallWebSearch(prompt) {
  if (!geminiKey()) throw new Error('gemini not configured');
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: geminiKey() });
  const resp = await ai.models.generateContent({
    model: RESEARCH_MODEL(),
    contents: prompt,
    config: { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingBudget: 0 } },
  });
  return typeof resp.text === 'function' ? resp.text() : (resp.text ?? '');
}

// Test seam: inject the web-search call so tests never hit the network.
export const dependencies = { callWebSearch: defaultCallWebSearch };
export function __setResearchCallForTests(fn) { dependencies.callWebSearch = fn; }
export function __resetResearchCallForTests() { dependencies.callWebSearch = defaultCallWebSearch; }

export async function researchEventIdeas({ theme, audience, university } = {}) {
  const prompt = buildPrompt({ theme, audience, university });

  // Preferred path: real web search (Gemini Google Search grounding).
  try {
    const text = await dependencies.callWebSearch(prompt);
    const json = extractJson(text);
    if (json) return { source: 'web', ...normalise(json) };
  } catch {
    /* fall through to model knowledge */
  }

  // Fallback: no live web — use whatever provider the router has configured.
  try {
    const res = await runTier('premium', {
      system: 'You suggest university event ideas. Reply with ONLY the requested JSON object.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 800,
    });
    const json = extractJson(res?.text);
    if (json) return { source: 'model', ...normalise(json) };
  } catch {
    /* ignore */
  }

  return { error: 'Could not research event ideas right now. Please try again.' };
}
