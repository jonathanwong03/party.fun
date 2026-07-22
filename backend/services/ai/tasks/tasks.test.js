import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { __setProvidersForTests, __resetProvidersForTests } from '../modelRouter.js';
import { suggestEventCopy } from './suggestEventCopy.js';
import { revenueTips } from './revenueTips.js';
import { operationalCostTips } from './operationalCostTips.js';
import { recommendEvents } from './recommendEvents.js';
import { answerAppQuestion } from './answerAppQuestion.js';
import { chat } from './chat.js';

afterEach(() => __resetProvidersForTests());

// The single Gemini mock provider that returns a canned text response per call.
function withResponse(text) {
  __setProvidersForTests({
    gemini: { isConfigured: () => true, generate: async ({ model }) => ({ text, provider: 'mock', model }) },
  });
}

function withNoProvider() {
  __setProvidersForTests({
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

test("suggestEventCopy mode:'titles' returns up to 3 names and no descriptions", async () => {
  withResponse('{"names":["A","B","C","D","E"],"descriptions":["ignored"]}');
  const out = await suggestEventCopy({ title: 'rave', mode: 'titles' });
  assert.equal(out.available, true);
  assert.deepEqual(out.names, ['A', 'B', 'C']);
  assert.deepEqual(out.descriptions, []);
});

test("suggestEventCopy mode:'descriptions' returns descriptions and no names", async () => {
  withResponse('{"names":["ignored"],"descriptions":["One.","Two.","Three."]}');
  const out = await suggestEventCopy({ title: 'rave', mode: 'descriptions' });
  assert.equal(out.available, true);
  assert.deepEqual(out.names, []);
  assert.equal(out.descriptions.length, 3);
});

test('revenueTips returns parsed tips', async () => {
  withResponse('{"tips":[{"title":"Lower early-bird","detail":"...","impact":"high"}]}');
  const out = await revenueTips({ event: { title: 'X' }, economics: { totalRevenue: 100, totalCost: 20, profit: 80, ticketCount: 10 } });
  assert.equal(out.available, true);
  assert.equal(out.tips[0].impact, 'high');
});

test('operationalCostTips returns parsed cost categories', async () => {
  withResponse('{"costs":[{"name":"Venue hire","why":"needs a hall"},{"name":"F&B","why":"snacks"},{"name":"AV","why":"sound system"}]}');
  const out = await operationalCostTips({ event: { title: 'Rooftop Party', description: 'a night with music' } });
  assert.equal(out.available, true);
  assert.equal(out.costs.length, 3);
  assert.equal(out.costs[0].name, 'Venue hire');
});

test('operationalCostTips reports unavailable with no provider', async () => {
  withNoProvider();
  const out = await operationalCostTips({ event: { title: 'X' } });
  assert.equal(out.available, false);
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
