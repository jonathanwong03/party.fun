import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { __setProvidersForTests, __resetProvidersForTests, listConfiguredModels } from '../modelRouter.js';
import { runAgent } from './runAgent.js';
import { EXECUTORS } from './tools.js';

afterEach(() => __resetProvidersForTests());

// Provider whose chatWithTools returns a scripted sequence of normalised results.
function scripted(name, steps) {
  let i = 0;
  return {
    isConfigured: () => true,
    chatWithTools: async ({ messages }) => {
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if (typeof step === 'function') return step(messages);
      return { ...step, provider: name, model: 'mock' };
    },
  };
}
function unconfigured() { return { isConfigured: () => false, chatWithTools: async () => ({}) }; }

const ctxWith = (events) => ({
  userId: 'u1',
  role: 'user',
  supabase: { rpc: async () => ({ data: events, error: null }) },
});

test('runAgent executes a tool call then returns the final answer', async () => {
  __setProvidersForTests({
    anthropic: scripted('anthropic', [
      { text: '', toolCalls: [{ id: 't1', name: 'search_events', args: { query: 'music' } }] },
      { text: 'Found 1 music event for you.', toolCalls: [] },
    ]),
    openai: unconfigured(),
    gemini: unconfigured(),
  });
  const events = [{ id: 'e1', title: 'Live Music Night', description: 'bands', status: 'early_bird', hostId: 'other', statuses: [{ price: 12 }], active_ticket_count: 5, hypeThreshold: 10 }];
  const out = await runAgent({ system: 's', messages: [{ role: 'user', content: 'find music' }], ctx: ctxWith(events) });
  assert.equal(out.available, true);
  assert.match(out.reply, /music/i);
  assert.equal(out.provider, 'anthropic');
});

test('runAgent falls back to another provider when the first errors', async () => {
  __setProvidersForTests({
    anthropic: { isConfigured: () => true, chatWithTools: async () => { throw new Error('boom'); } },
    openai: scripted('openai', [{ text: 'Hi from GPT', toolCalls: [] }]),
    gemini: unconfigured(),
  });
  const out = await runAgent({ system: 's', messages: [{ role: 'user', content: 'hi' }], ctx: ctxWith([]) });
  assert.equal(out.available, true);
  assert.equal(out.provider, 'openai');
  assert.match(out.reply, /GPT/);
});

test('runAgent returns available:false when no provider is configured', async () => {
  __setProvidersForTests({ anthropic: unconfigured(), openai: unconfigured(), gemini: unconfigured() });
  const out = await runAgent({ system: 's', messages: [{ role: 'user', content: 'hi' }], ctx: ctxWith([]) });
  assert.equal(out.available, false);
});

test('search_events filters by query/price and flags own events', async () => {
  const events = [
    { id: 'e1', title: 'Jazz Night', description: 'live music', status: 'early_bird', hostId: 'other', statuses: [{ price: 10 }], active_ticket_count: 2, hypeThreshold: 10 },
    { id: 'e2', title: 'Pricey Gala', description: 'music', status: 'early_bird', hostId: 'other', statuses: [{ price: 99 }], active_ticket_count: 1, hypeThreshold: 10 },
    { id: 'e3', title: 'My Event', description: 'music', status: 'early_bird', hostId: 'u1', statuses: [{ price: 5 }], active_ticket_count: 1, hypeThreshold: 10 },
    { id: 'e4', title: 'Old Music', description: 'music', status: 'cancelled', hostId: 'other', statuses: [{ price: 1 }] },
  ];
  const out = await EXECUTORS.search_events({ query: 'music', maxPrice: 20 }, ctxWith(events));
  const ids = out.events.map((e) => e.id);
  assert.deepEqual(ids.sort(), ['e1', 'e3']); // e2 too pricey, e4 cancelled
  assert.equal(out.events.find((e) => e.id === 'e3').mine, true);
});

test('get_event_details returns details for a visible event, error otherwise', async () => {
  const events = [{ id: 'e1', title: 'Gig', description: 'd', status: 'greenlit', hostId: 'u1', statuses: [{ statusName: 'early_bird', price: 8, ticketCapacity: 50 }], active_ticket_count: 7, hypeThreshold: 10 }];
  const ok = await EXECUTORS.get_event_details({ eventId: 'e1' }, ctxWith(events));
  assert.equal(ok.title, 'Gig');
  assert.equal(ok.mine, true);
  const miss = await EXECUTORS.get_event_details({ eventId: 'nope' }, ctxWith(events));
  assert.ok(miss.error);
});

test('listConfiguredModels reflects only configured providers', async () => {
  __setProvidersForTests({
    anthropic: { isConfigured: () => true, chatWithTools: async () => ({}) },
    openai: unconfigured(),
    gemini: unconfigured(),
  });
  const models = listConfiguredModels();
  assert.ok(models.length >= 1);
  assert.ok(models.every((m) => m.provider === 'anthropic'));
  assert.ok(models.some((m) => m.tier === 'premium'));
});
