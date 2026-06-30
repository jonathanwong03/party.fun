import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { __setProvidersForTests, __resetProvidersForTests } from '../modelRouter.js';
import { suggestEventCopy } from './suggestEventCopy.js';
import { revenueTips } from './revenueTips.js';
import { recommendEvents } from './recommendEvents.js';
import { answerAppQuestion } from './answerAppQuestion.js';
import { chat } from './chat.js';

afterEach(() => __resetProvidersForTests());

// A single mock provider (keyed as `anthropic`, the first candidate in every tier)
// that returns a canned text response per call.
function withResponse(text) {
  __setProvidersForTests({
    anthropic: { isConfigured: () => true, generate: async ({ model }) => ({ text, provider: 'mock', model }) },
    openai: { isConfigured: () => false, generate: async () => ({}) },
    gemini: { isConfigured: () => false, generate: async () => ({}) },
  });
}

function withNoProvider() {
  __setProvidersForTests({
    anthropic: { isConfigured: () => false, generate: async () => ({}) },
    openai: { isConfigured: () => false, generate: async () => ({}) },
    gemini: { isConfigured: () => false, generate: async () => ({}) },
  });
}

test('suggestEventCopy parses names and descriptions (tolerates code fences)', async () => {
  withResponse('```json\n{"names":["Neon Night","Glow Jam"],"descriptions":["A bright party."]}\n```');
  const out = await suggestEventCopy({ title: 'rave' });
  assert.equal(out.available, true);
  assert.deepEqual(out.names, ['Neon Night', 'Glow Jam']);
  assert.equal(out.descriptions.length, 1);
});

test('revenueTips returns parsed tips', async () => {
  withResponse('{"tips":[{"title":"Lower early-bird","detail":"...","impact":"high"}]}');
  const out = await revenueTips({ event: { title: 'X' }, forecast: { projectedRevenue: 100, operationalCosts: [] } });
  assert.equal(out.available, true);
  assert.equal(out.tips[0].impact, 'high');
});

test('recommendEvents only returns ids from the candidate list', async () => {
  withResponse('{"recommendations":[{"eventId":"e1","reason":"matches music"},{"eventId":"ghost","reason":"nope"}]}');
  const out = await recommendEvents({ interests: 'music', candidates: [{ id: 'e1', title: 'Gig', cheapestPrice: 10 }] });
  assert.equal(out.recommendations.length, 1);
  assert.equal(out.recommendations[0].eventId, 'e1');
  assert.equal(out.recommendations[0].title, 'Gig');
});

test('recommendEvents short-circuits with no candidates', async () => {
  withResponse('{"recommendations":[]}');
  const out = await recommendEvents({ interests: 'music', candidates: [] });
  assert.deepEqual(out, { available: true, recommendations: [] });
});

test('answerAppQuestion returns the answer text', async () => {
  withResponse('Wallet refunds are instant; card refunds go back to the card.');
  const out = await answerAppQuestion({ question: 'How do refunds work?' });
  assert.equal(out.available, true);
  assert.match(out.answer, /refunds/i);
});

test('chat returns a reply', async () => {
  withResponse('Try a rooftop theme!');
  const out = await chat({ messages: [{ role: 'user', content: 'idea?' }] });
  assert.equal(out.available, true);
  assert.match(out.reply, /rooftop/i);
});

test('tasks degrade to available:false when no provider is configured', async () => {
  withNoProvider();
  assert.equal((await suggestEventCopy({ title: 'x' })).available, false);
  assert.equal((await answerAppQuestion({ question: 'hi' })).available, false);
  assert.equal((await chat({ messages: [{ role: 'user', content: 'hi' }] })).available, false);
});
