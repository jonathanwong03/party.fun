import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { __resetProvidersForTests, __setProvidersForTests } from '../modelRouter.js';
import { runGraph, resumeGraph, classifyIntent, BRANCH_TOOLS, OFF_TOPIC_REPLY, ROLE_BLOCK_REPLY, guardAllows, looksClearlyOffTopic, looksLikePurchase, __setBuildModelForTests, __setAgentsForTests, __setClassifyForTests, __setGuardForTests, __resetGraphForTests } from './eventGraph.js';
import { EXECUTORS, AGENT_TOOLS, TOOLS_BY_NAME } from './tools.js';
import { executeAction } from './actions.js';
import { __setForecastForTests, __resetForecastForTests } from '../../weatherService.js';
import { __setResearchCallForTests, __resetResearchCallForTests } from './research.js';
import { __setEmbedForTests, __resetEmbedForTests } from '../embeddingService.js';
import { sanitizeAiReply } from '../responseSanitizer.js';

afterEach(() => { __resetProvidersForTests(); __resetGraphForTests(); __resetForecastForTests(); __resetResearchCallForTests(); __resetEmbedForTests(); delete process.env.GEMINI_API_KEY; });

// A fake branch agent: appends a fixed set of NEW messages onto the input list,
// mimicking what createAgent returns from `.invoke({ messages })`.
const fakeAgent = (newMessages) => ({ invoke: async ({ messages }) => ({ messages: [...messages, ...newMessages] }) });
const allBranches = (agent) => ({ read_only: agent, discovery: agent, best_fit: agent, event_mgmt: agent, transaction: agent });
const useAgents = (agent) => __setAgentsForTests(() => allBranches(agent));
const useModel = () => __setBuildModelForTests(async () => ({ model: {}, provider: 'gemini', modelId: 'mock' }));
const useClassify = (intent) => __setClassifyForTests(async () => intent);

// Message helpers.
const say = (text) => new AIMessage(text);
const toolMsg = (obj, name = 'tool', id = 't1') => new ToolMessage({ content: JSON.stringify(obj), tool_call_id: id, name });

const ctxWith = (events, role = 'user') => ({
  userId: 'u1',
  role,
  supabase: { rpc: async () => ({ data: events, error: null }) },
});

// Richer ctx that also mocks .from() for USER / WALLET_TRANSACTIONS / EVENT_DRAFTS reads.
const ctxFull = ({ events = [], user = { walletBalance: 50, cardBrand: 'visa', cardLast4: '4242' }, drafts = [] } = {}) => ({
  userId: 'u1',
  role: 'user',
  supabase: {
    rpc: async () => ({ data: events, error: null }),
    from: (table) => {
      if (table === 'USER') return { select: () => ({ eq: () => ({ single: async () => ({ data: user, error: null }) }) }) };
      if (table === 'WALLET_TRANSACTIONS') return { select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
      if (table === 'EVENT_DRAFTS') return { select: () => ({ order: async () => ({ data: drafts.map((d) => ({ id: d.id, payload: d })), error: null }) }) };
      return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) };
    },
  },
});

const topupProposal = { id: 'p1', action: 'topup', eventId: null, title: 'Wallet top-up', summary: 'Top up $20.', payload: { amount: 20 } };

test('runGraph runs the classified branch and returns the final answer', async () => {
  useModel(); useClassify('discovery');
  useAgents(fakeAgent([toolMsg({ events: [{ id: 'e1', title: 'Live Music Night' }] }, 'search_events'), say('Found 1 music event for you.')]));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'find music' }], ctx: ctxWith([]) });
  assert.equal(out.available, true);
  assert.equal(out.status, 'done');
  assert.match(out.reply, /music/i);
  assert.equal(out.provider, 'gemini');
});

test('final replies strip UUIDs and parenthetical IDs', async () => {
  const uuid = '0de00006-0000-4000-8000-000000000005';
  assert.equal(sanitizeAiReply(`1. Gala (ID: ${uuid})`), '1. Gala');

  useModel(); useClassify('discovery');
  useAgents(fakeAgent([say(`1. Gala (ID: ${uuid}) is available.`)]));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'list events' }], ctx: ctxWith([]) });
  assert.doesNotMatch(out.reply, /[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  assert.doesNotMatch(out.reply, /\bID:/i);
});

test('classify routes to the matching branch agent', async () => {
  useModel(); useClassify('event_mgmt');
  __setAgentsForTests(() => ({
    read_only: fakeAgent([say('answer-branch')]),
    discovery: fakeAgent([say('discovery-branch')]),
    best_fit: fakeAgent([say('bestfit-branch')]),
    event_mgmt: fakeAgent([say('manage-branch')]),
    transaction: fakeAgent([say('transact-branch')]),
  }));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'edit my event' }], ctx: ctxWith([], 'organiser') });
  assert.match(out.reply, /manage-branch/);
});

test('a purchase ask is force-routed to the transaction branch (never "no functionality")', async () => {
  useModel();
  // Classifier deliberately returns the WRONG label — the deterministic override must win.
  useClassify('read_only');
  __setAgentsForTests(() => ({
    read_only: fakeAgent([say('read-only-branch')]),
    discovery: fakeAgent([say('discovery-branch')]),
    best_fit: fakeAgent([say('bestfit-branch')]),
    event_mgmt: fakeAgent([say('manage-branch')]),
    transaction: fakeAgent([say('transact-branch')]),
  }));
  const buy = await runGraph({ system: 's', messages: [{ role: 'user', content: 'help me purchase 4 tickets' }], ctx: ctxWith([]) });
  assert.match(buy.reply, /transact-branch/);

  // "yes" to the assistant's own purchase offer also enters the buy flow.
  const yes = await runGraph({
    system: 's',
    messages: [
      { role: 'assistant', content: 'Would you like to purchase tickets for this event?' },
      { role: 'user', content: 'yes' },
    ],
    ctx: ctxWith([]),
  });
  assert.match(yes.reply, /transact-branch/);
});

test('looksLikePurchase fires on REQUESTS but never on questions about buying', () => {
  // Real purchase requests → buy flow.
  for (const q of ['help me purchase 4 tickets', 'buy tickets for Neon Rave', 'i want to purchase 4 tickets',
    'can you help me buy 2 tickets?', 'please buy me 2 tickets']) {
    assert.equal(looksLikePurchase(q), true, `should be a purchase: ${q}`);
  }
  // Questions ABOUT buying must be answered, not turned into a purchase.
  for (const q of ['can i purchase tickets after 24 july?', 'can i still buy tickets for Neon Rave?',
    'is it too late to buy tickets?', 'am i able to purchase tickets tomorrow?']) {
    assert.equal(looksLikePurchase(q), false, `should be a question: ${q}`);
  }
});

test('a question about buying is NOT force-routed into the transaction branch', async () => {
  useModel(); useClassify('read_only');
  __setAgentsForTests(() => ({
    read_only: fakeAgent([say('read-only-branch')]),
    discovery: fakeAgent([say('discovery-branch')]),
    best_fit: fakeAgent([say('bestfit-branch')]),
    event_mgmt: fakeAgent([say('manage-branch')]),
    transaction: fakeAgent([say('transact-branch')]),
  }));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'can i purchase tickets after 24 july?' }], ctx: ctxWith([]) });
  assert.match(out.reply, /read-only-branch/, 'a question must be answered, not routed to the buy flow');
});

test('get_event_details returns the eligibility facts that ground yes/no answers', async () => {
  const events = [{
    id: 'e1', title: 'Neon Rave', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3),
    deadline: inDaysIso(1), maxCapacity: 10, active_ticket_count: 10, hypeThreshold: 5,
    restricted_university: 'SMU', viewer_can_attend: false, canEdit: false, canCancel: false,
    isCoOrganiser: false, statuses: [{ statusName: 'early_bird', price: 20, ticketCapacity: 10 }],
  }];
  const d = await EXECUTORS.get_event_details({ eventId: 'Neon Rave' }, ctxFull({ events }));
  assert.equal(d.maxCapacity, 10);
  assert.equal(d.spotsLeft, 0);
  assert.equal(d.soldOut, true);              // "is it sold out?" → Yes
  assert.equal(d.isOpen, false);              // sold out ⇒ can't still buy
  assert.equal(d.restrictedUniversity, 'SMU');
  assert.equal(d.canAttendUniversity, false); // "can I attend?" → No (other university)
  assert.equal(d.alreadyPurchased, false);
  assert.equal(d.canEdit, false);
  assert.equal(d.isPast, false);
  assert.equal(d.deadlinePassed, false);
});

test('get_event_details resolves NON-joinable events so the bot can give the reason', async () => {
  // attendableEvents excludes cancelled/past/purchased, but get_event_details reads the WIDER
  // visible pool — so a question about one still resolves and carries the reason facts.
  const base = { hostId: 'other', startDate: inDaysIso(3), deadline: inDaysIso(1), maxCapacity: 50, active_ticket_count: 1, statuses: [{ statusName: 'early_bird', price: 5, ticketCapacity: 50 }] };
  const events = [
    { ...base, id: 'e1', title: 'Cancelled Gala', status: 'cancelled' },
    { ...base, id: 'e2', title: 'Old Mixer', status: 'completed', startDate: inDaysIso(-5), endDate: inDaysIso(-5) },
    { ...base, id: 'e3', title: 'My Rave', status: 'early_bird' },
  ];
  // ctx where the user already holds tickets for e3. get_event_details reads only rpc
  // (get_events + get_profile) for a non-owned event, so no .from() stub is needed.
  const profileTickets = { tickets: [{ eventId: 'e3', tab: 'upcoming', activeTicketCount: 2 }] };
  const ctx = { userId: 'u1', role: 'user', supabase: {
    rpc: async (name) => ({ data: name === 'get_profile' ? profileTickets : events, error: null }),
  } };

  const cancelled = await EXECUTORS.get_event_details({ eventId: 'Cancelled Gala' }, ctx);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.isOpen, false);

  const past = await EXECUTORS.get_event_details({ eventId: 'Old Mixer' }, ctx);
  assert.equal(past.isPast, true);
  assert.equal(past.isOpen, false);

  const owned = await EXECUTORS.get_event_details({ eventId: 'My Rave' }, ctx);
  assert.equal(owned.alreadyPurchased, true);
});

test('get_event_details: an open, unrestricted event reports isOpen', async () => {
  const events = [{
    id: 'e1', title: 'Book Fair', status: 'early_bird', hostId: 'other', startDate: inDaysIso(5),
    deadline: inDaysIso(2), maxCapacity: 50, active_ticket_count: 3, hypeThreshold: 10,
    restricted_university: '', viewer_can_attend: true, statuses: [{ statusName: 'early_bird', price: 5, ticketCapacity: 50 }],
  }];
  const d = await EXECUTORS.get_event_details({ eventId: 'Book Fair' }, ctxFull({ events }));
  assert.equal(d.isOpen, true);
  assert.equal(d.soldOut, false);
  assert.equal(d.spotsLeft, 47);
  assert.equal(d.restrictedUniversity, null);   // blank ⇒ open to everyone
  assert.equal(d.canAttendUniversity, true);
});

test('read_only and discovery branches still bind the buy tool as a safety net', () => {
  assert.ok(BRANCH_TOOLS.read_only.includes('propose_pledge'));
  assert.ok(BRANCH_TOOLS.discovery.includes('propose_pledge'));
  assert.ok(BRANCH_TOOLS.transaction.includes('propose_pledge'));
});

test('looksClearlyOffTopic flags math/coding/trivia but not event asks', () => {
  assert.equal(looksClearlyOffTopic('what is 3*3'), true);
  assert.equal(looksClearlyOffTopic('what is 4 + 4'), true);
  assert.equal(looksClearlyOffTopic('3*3'), true);
  assert.equal(looksClearlyOffTopic('calculate the square root of 9'), true);
  assert.equal(looksClearlyOffTopic('write me some python code'), true);
  assert.equal(looksClearlyOffTopic('what is the capital of France'), true);
  // Event-related asks (incl. bare numbers as a reply) are NOT flagged.
  assert.equal(looksClearlyOffTopic('3'), false);
  assert.equal(looksClearlyOffTopic('3 tickets'), false);
  assert.equal(looksClearlyOffTopic('what events can I join'), false);
  assert.equal(looksClearlyOffTopic('gymming for newbie'), false);
});

test('a clearly off-topic question is refused even after an event-related turn', async () => {
  useModel(); useAgents(fakeAgent([say('branch-should-not-run')]));
  const out = await runGraph({
    system: 's',
    messages: [
      { role: 'assistant', content: 'Here are the live events hosted across all organisers.' },
      { role: 'user', content: 'what is 3*3' },
    ],
    ctx: ctxWith([]),
  });
  assert.equal(out.reply, OFF_TOPIC_REPLY);
});

test('normal users asking to manage events are refused before branch tools run', async () => {
  useModel(); useClassify('event_mgmt');
  let branchCalled = false;
  __setAgentsForTests(() => allBranches({ invoke: async ({ messages }) => { branchCalled = true; return { messages: [...messages, say('should not run')] }; } }));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'i want to create an event' }], ctx: ctxWith([]) });
  assert.equal(out.reply, ROLE_BLOCK_REPLY);
  assert.equal(branchCalled, false);
  assert.deepEqual(out.proposals, []);
});

test('organisers can still enter the event management branch', async () => {
  useModel(); useClassify('event_mgmt');
  useAgents(fakeAgent([say('organiser branch')]));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'change my event price' }], ctx: { ...ctxWith([]), role: 'organiser' } });
  assert.equal(out.reply, 'organiser branch');
});

test('organisers asking to create an event get an immediate draft proposal', async () => {
  useModel(); useClassify('event_mgmt');
  let branchCalled = false;
  __setAgentsForTests(() => allBranches({ invoke: async ({ messages }) => { branchCalled = true; return { messages: [...messages, say('should not ask follow-up')] }; } }));
  const out = await runGraph({
    system: 's',
    messages: [{ role: 'user', content: 'can you create an event for me' }],
    ctx: { ...ctxWith([]), role: 'organiser' },
  });
  assert.equal(out.status, 'awaiting_confirmation');
  assert.equal(branchCalled, false);
  assert.equal(out.proposals.length, 1);
  assert.equal(out.proposals[0].action, 'create_event_draft');
  assert.ok(out.proposals[0].payload.title);
  assert.ok(out.proposals[0].payload.startDate);
});

test('branch toolsets are scoped (read/discovery expose only the buy proposal, no management writes)', () => {
  assert.ok(BRANCH_TOOLS.transaction.includes('propose_topup'));
  assert.ok(BRANCH_TOOLS.event_mgmt.includes('propose_cancel_event'));
  // propose_pledge is deliberately bound in the read branches as a safety net so a
  // mis-routed purchase can't produce "I don't have that functionality". It is still a
  // PROPOSAL the user must confirm. No other write may leak into a read branch.
  const writesIn = (branch) => BRANCH_TOOLS[branch].filter((t) => t.startsWith('propose_'));
  assert.deepEqual(writesIn('read_only'), ['propose_pledge']);
  assert.deepEqual(writesIn('discovery'), ['propose_pledge']);
});

test('every branch binds the universal READ tools (no false capability denials)', () => {
  // The recurring bug in this file: a scoped branch lacks a read tool, classify routes there,
  // and the model TRUTHFULLY says it can't do the thing — "I cannot provide weather forecasts",
  // "I don't have that functionality". classify re-runs per turn with no stickiness, so the
  // same conversation flips between capable and incapable branches. Scoping a read-only tool
  // buys only prompt economy; this invariant is what stops the fourth recurrence.
  const universal = ['get_current_date', 'get_weather', 'get_event_forecast', 'suggest_operational_costs', 'get_event_details',
    'get_my_hosted_events', 'get_my_joined_events', 'get_wallet', 'list_my_drafts', 'get_app_info'];
  for (const branch of Object.keys(BRANCH_TOOLS)) {
    for (const tool of universal) {
      assert.ok(BRANCH_TOOLS[branch].includes(tool), `${branch} must bind ${tool}`);
    }
  }
  // …and every name must be a real tool, or it is silently dropped by pickTools.
  for (const [branch, names] of Object.entries(BRANCH_TOOLS)) {
    for (const n of names) assert.ok(TOOLS_BY_NAME[n], `${branch} binds unknown tool ${n}`);
  }
});

test('ask mode interrupts for confirmation; confirm executes, reject does not', async () => {
  useModel(); useClassify('transaction');
  useAgents(fakeAgent([toolMsg({ proposal: topupProposal }, 'propose_topup'), say("I've proposed a $20 top-up — confirm to apply.")]));
  const ctx = ctxWith([]); // topup fails safe (stripe_disabled) without Stripe, which is enough to prove execute ran

  const first = await runGraph({ system: 's', messages: [{ role: 'user', content: 'top up $20' }], ctx });
  assert.equal(first.status, 'awaiting_confirmation');
  assert.deepEqual(first.proposals.map((p) => p.action), ['topup']);
  assert.ok(first.threadId);

  const confirmed = await resumeGraph({ system: 's', ctx, threadId: first.threadId, proposalId: 'p1', decision: 'confirm' });
  assert.equal(confirmed.status, 'done');
  assert.equal(confirmed.results.length, 1);
  assert.equal(confirmed.results[0].action, 'topup');

  const second = await runGraph({ system: 's', messages: [{ role: 'user', content: 'top up $20' }], ctx });
  const rejected = await resumeGraph({ system: 's', ctx, threadId: second.threadId, proposalId: 'p1', decision: 'reject' });
  assert.equal(rejected.status, 'done');
  assert.equal(rejected.results.length, 0);
});

test('auto mode executes inline', async () => {
  useModel(); useClassify('transaction');
  useAgents(fakeAgent([toolMsg({ proposal: topupProposal }, 'propose_topup'), say('Proposed.')]));
  const ctx = ctxWith([]);

  const auto = await runGraph({ system: 's', messages: [{ role: 'user', content: 'top up $20' }], ctx, mode: 'auto' });
  assert.equal(auto.status, 'done');
  assert.equal(auto.results.length, 1);
});

test('runGraph returns a graceful reply when a branch agent errors', async () => {
  useModel(); useClassify('read_only');
  __setAgentsForTests(() => allBranches({ invoke: async () => { throw new Error('boom'); } }));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'hi' }], ctx: ctxWith([]) });
  assert.equal(out.available, true);
  assert.equal(out.status, 'done');
  assert.ok(out.reply && out.reply.length > 0);
  assert.deepEqual(out.proposals, []);
});

test('runGraph returns available:false when no model is configured', async () => {
  __setBuildModelForTests(async () => null);
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'hi' }], ctx: ctxWith([]) });
  assert.equal(out.available, false);
});

test('classifyIntent routes money, management, best-fit and discovery phrasings', () => {
  assert.equal(classifyIntent('top up $20 to my wallet'), 'transaction');
  assert.equal(classifyIntent('buy 2 tickets to the gala'), 'transaction');
  assert.equal(classifyIntent('cancel my rooftop event'), 'event_mgmt');
  assert.equal(classifyIntent('change the early-bird price'), 'event_mgmt');
  assert.equal(classifyIntent('what is the cheapest event for me'), 'best_fit');
  assert.equal(classifyIntent('show me events this weekend'), 'discovery');
  assert.equal(classifyIntent('how does greenlighting work'), 'read_only');
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

test('suggest_operational_costs brainstorms categories for a visible event by name', async () => {
  // Stub the premium model the operationalCostTips task calls, so we assert wiring not the LLM.
  __setProvidersForTests({
    gemini: {
      isConfigured: () => true,
      generate: async ({ model }) => ({
        text: '{"costs":[{"name":"Venue hire","why":"needs a hall"},{"name":"Referees","why":"officiating"},{"name":"F&B","why":"snacks"}]}',
        provider: 'mock',
        model,
      }),
    },
  });
  const events = [{ id: 'e1', title: 'UniFootball Fest', description: 'a 5-a-side tournament', status: 'greenlit', hostId: 'u1', statuses: [{ price: 8 }], active_ticket_count: 3, hypeThreshold: 10 }];
  const ok = await EXECUTORS.suggest_operational_costs({ eventId: 'UniFootball Fest' }, ctxWith(events));
  assert.equal(ok.title, 'UniFootball Fest');
  assert.equal(ok.costs.length, 3);
  assert.equal(ok.costs[0].name, 'Venue hire');
  const miss = await EXECUTORS.suggest_operational_costs({ eventId: 'nope' }, ctxWith(events));
  assert.ok(miss.error);
});

test('get_event_details returns details for a visible event, error otherwise', async () => {
  const events = [{ id: 'e1', title: 'Gig', description: 'd', status: 'greenlit', hostId: 'u1', statuses: [{ statusName: 'early_bird', price: 8, ticketCapacity: 50 }], active_ticket_count: 7, hypeThreshold: 10 }];
  const ok = await EXECUTORS.get_event_details({ eventId: 'e1' }, ctxWith(events));
  assert.equal(ok.title, 'Gig');
  assert.equal(ok.mine, true);
  const miss = await EXECUTORS.get_event_details({ eventId: 'nope' }, ctxWith(events));
  assert.ok(miss.error);
});

test('get_event_details exposes status + current price', async () => {
  const events = [{ id: 'e1', title: 'Gig', status: 'greenlit', hostId: 'other', statuses: [{ statusName: 'greenlit', price: 8 }], active_ticket_count: 12, hypeThreshold: 10 }];
  const out = await EXECUTORS.get_event_details({ eventId: 'e1' }, ctxWith(events));
  assert.equal(out.status, 'greenlit');
  assert.equal(out.currentPrice, 8);
  assert.equal(out.mine, false);
  assert.equal(out.revenueSoFar, undefined); // revenue is host-only; not the caller's event
});

test('currentPrice reflects the ACTIVE tier, not the cheapest tier', async () => {
  // Greenlit event whose early-bird allocation is sold out → the greenlit tier is on sale now.
  const greenlitRows = [{
    id: 'e1', title: 'Gala', status: 'greenlit', hostId: 'other', active_ticket_count: 55, hypeThreshold: 10,
    statuses: [
      { statusName: 'early_bird', price: 18, sold: 10, ticketCapacity: 10 },
      { statusName: 'greenlit', price: 30, sold: 45, ticketCapacity: 200 },
    ],
  }];
  const greenlit = await EXECUTORS.get_event_details({ eventId: 'e1' }, ctxWith(greenlitRows));
  assert.equal(greenlit.status, 'greenlit');
  assert.equal(greenlit.currentPrice, 30); // was $18 (cheapest tier) before the fix
  assert.equal(greenlit.cheapestPrice, undefined); // no longer surfaced

  // Early-bird still open → early-bird price is current.
  const earlyRows = [{
    id: 'e2', title: 'Mixer', status: 'early_bird', hostId: 'other', active_ticket_count: 3, hypeThreshold: 10,
    statuses: [
      { statusName: 'early_bird', price: 18, sold: 3, ticketCapacity: 10 },
      { statusName: 'greenlit', price: 30, sold: 0, ticketCapacity: 200 },
    ],
  }];
  const early = await EXECUTORS.get_event_details({ eventId: 'e2' }, ctxWith(earlyRows));
  assert.equal(early.currentPrice, 18);
});

test('get_my_hosted_events exposes currentPrice + revenueSoFar', async () => {
  const events = [{ id: 'e1', title: 'Mine', status: 'early_bird', hostId: 'u1', statuses: [{ statusName: 'early_bird', price: 10 }], active_ticket_count: 3, hypeThreshold: 10 }];
  const out = await EXECUTORS.get_my_hosted_events({}, ctxWith(events));
  const ev = out.events.find((e) => e.id === 'e1');
  assert.equal(ev.currentPrice, 10);
  assert.equal(ev.status, 'early_bird');
  assert.equal(ev.revenueSoFar, 0); // mocked RPC has no revenue rows → 0
});

test('propose_update_event returns a proposal for own event, errors for non-owner', async () => {
  const own = [{ id: 'e1', title: 'My Gig', status: 'early_bird', hostId: 'u1', statuses: [{ statusName: 'early_bird', price: 12 }] }];
  const ok = await EXECUTORS.propose_update_event({ eventId: 'e1', earlyPrice: 8, venue: 'Rooftop' }, ctxWith(own));
  assert.equal(ok.proposal.action, 'update_event');
  assert.equal(ok.proposal.payload.earlyPrice, 8);
  assert.equal(ok.proposal.payload.venue, 'Rooftop');
  assert.match(ok.proposal.summary, /12\.00 → \$8\.00/);

  const notMine = [{ id: 'e1', title: 'Theirs', status: 'early_bird', hostId: 'other', statuses: [] }];
  const blocked = await EXECUTORS.propose_update_event({ eventId: 'e1', earlyPrice: 8 }, ctxWith(notMine));
  assert.ok(blocked.error);
});

test('propose_create_event drafts an event and requires title + dates', async () => {
  const dates = { startDate: '2026-08-15T19:00:00+08:00', endDate: '2026-08-15T23:00:00+08:00', deadline: '2026-08-10T23:59:00+08:00' };
  const organiserCtx = { ...ctxWith([]), role: 'organiser' };
  const out = await EXECUTORS.propose_create_event({ title: 'Rooftop Jam', venue: 'SoR', earlyPrice: 10, ...dates }, organiserCtx);
  assert.equal(out.proposal.action, 'create_event_draft');
  assert.equal(out.proposal.eventId, null);
  assert.equal(out.proposal.payload.title, 'Rooftop Jam');
  assert.equal(out.proposal.payload.startDate, dates.startDate);

  const noTitle = await EXECUTORS.propose_create_event({ ...dates, title: '  ' }, organiserCtx);
  assert.ok(noTitle.error);
  const noDates = await EXECUTORS.propose_create_event({ title: 'Dateless' }, organiserCtx);
  assert.match(noDates.error, /deadline/i);

  const normalUser = await EXECUTORS.propose_create_event({ title: 'User Event', ...dates }, ctxWith([]));
  assert.match(normalUser.error, /Only organisers/);
});

test('list_available_events excludes own, purchased, given-away, completed, cancelled and already-started events', async () => {
  const events = [
    { id: 'e1', title: 'Buyable', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 10 }] },
    { id: 'e2', title: 'Mine', status: 'early_bird', hostId: 'u1', startDate: inDaysIso(3), statuses: [{ price: 5 }] },
    { id: 'e3', title: 'Held tickets', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 8 }] },
    { id: 'e4', title: 'Already started', status: 'early_bird', hostId: 'other', startDate: inDaysIso(-1), statuses: [{ price: 7 }] },
    { id: 'e5', title: 'Gave away all', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 6 }] },
    { id: 'e6', title: 'Completed', status: 'completed', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 6 }] },
    { id: 'e7', title: 'Cancelled', status: 'cancelled', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 6 }] },
  ];
  // Matches the UI: a booking in the 'upcoming' (active) OR 'cancelled' (given-away) tab
  // means "already purchased" and can't be bought again. e3 = active, e5 = all given away.
  const tickets = [
    { eventId: 'e3', tab: 'upcoming', activeTicketCount: 1 },
    { eventId: 'e5', tab: 'cancelled', activeTicketCount: 0 },
  ];
  const ctx = {
    userId: 'u1',
    role: 'user',
    supabase: { rpc: async (name) => ({ data: name === 'get_profile' ? { tickets } : events, error: null }) },
  };
  const out = await EXECUTORS.list_available_events({}, ctx);
  assert.deepEqual(out.events.map((e) => e.id), ['e1']);
});

test('list_available_events reads derived_status (the real get_events field), not status', async () => {
  // get_events returns the live status as `derived_status`; the tool must honour it.
  const events = [
    { id: 'e1', title: 'Open', derived_status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 10 }] },
    { id: 'e2', title: 'Cancelled', derived_status: 'cancelled', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 5 }] },
  ];
  const ctx = { userId: 'u1', role: 'user', supabase: { rpc: async (name) => ({ data: name === 'get_profile' ? { myEventIds: [] } : events, error: null }) } };
  const out = await EXECUTORS.list_available_events({}, ctx);
  assert.deepEqual(out.events.map((e) => e.id), ['e1']); // non-empty, and the cancelled one is excluded
});

test('propose_invite_coorganiser returns a proposal for own event', async () => {
  const own = [{ id: 'e1', title: 'My Gig', status: 'early_bird', hostId: 'u1', statuses: [] }];
  const out = await EXECUTORS.propose_invite_coorganiser({ eventId: 'e1', identifier: 'al@uni.edu' }, ctxWith(own));
  assert.equal(out.proposal.action, 'invite_coorganiser');
  assert.equal(out.proposal.payload.identifier, 'al@uni.edu');
});

test('runGraph surfaces an update_event proposal from a propose_* tool result', async () => {
  useModel(); useClassify('event_mgmt');
  const proposal = { id: 'u:e1', action: 'update_event', eventId: 'e1', title: 'My Gig', summary: 'Update "My Gig": early-bird → $8.', payload: { earlyPrice: 8 } };
  useAgents(fakeAgent([toolMsg({ proposal }, 'propose_update_event'), say("I've proposed dropping the early-bird price to $8 — confirm to apply.")]));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'drop my price' }], ctx: ctxWith([]) });
  assert.equal(out.available, true);
  assert.equal(out.status, 'awaiting_confirmation');
  assert.equal(out.proposals.length, 1);
  assert.equal(out.proposals[0].action, 'update_event');
});

test('executeAction rejects unknown actions and non-owners', async () => {
  const sbWith = (rows) => ({ rpc: async () => ({ data: rows, error: null }) });
  const bogus = await executeAction({ sb: sbWith([]), user: { id: 'u1' }, action: 'nuke', eventId: 'e1' });
  assert.equal(bogus.error, 'invalid_action');

  const missing = await executeAction({ sb: sbWith([]), user: { id: 'u1' }, action: 'update_event', eventId: 'e1', payload: { earlyPrice: 5 } });
  assert.equal(missing.error, 'not_found');

  const notOwner = await executeAction({ sb: sbWith([{ id: 'e1', hostId: 'other' }]), user: { id: 'u1' }, action: 'update_event', eventId: 'e1', payload: { earlyPrice: 5 } });
  assert.equal(notOwner.error, 'not_owner');
});

// ── New wallet / lifecycle proposal tools ────────────────────────────────────
test('propose_topup returns a topup proposal, errors without a linked card', async () => {
  const ok = await EXECUTORS.propose_topup({ amount: 20 }, ctxFull({ user: { cardLast4: '4242' } }));
  assert.equal(ok.proposal.action, 'topup');
  assert.equal(ok.proposal.payload.amount, 20);
  const noCard = await EXECUTORS.propose_topup({ amount: 20 }, ctxFull({ user: { cardLast4: null } }));
  assert.ok(noCard.error);
  const badAmount = await EXECUTORS.propose_topup({ amount: 0 }, ctxFull({ user: { cardLast4: '4242' } }));
  assert.ok(badAmount.error);
});

test('propose_pledge proposes a wallet purchase, blocks own event, guides top-up when short', async () => {
  const events = [
    { id: 'e1', title: 'Gala', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 10 }] },
    { id: 'e2', title: 'Mine', status: 'early_bird', hostId: 'u1', startDate: inDaysIso(3), statuses: [{ price: 5 }] },
  ];
  const ctx = ctxFull({ events, user: { walletBalance: 100, cardLast4: '4242' } });
  const ok = await EXECUTORS.propose_pledge({ eventId: 'e1', qty: 2 }, ctx);
  assert.equal(ok.proposal.action, 'pledge');
  assert.equal(ok.proposal.payload.qty, 2);
  assert.match(ok.proposal.summary, /\$20\.00/);
  const own = await EXECUTORS.propose_pledge({ eventId: 'e2' }, ctx);
  assert.ok(own.error);
  // Wallet too low → guidance to top up by card, no proposal.
  const poor = ctxFull({ events, user: { walletBalance: 5, cardLast4: '4242' } });
  const short = await EXECUTORS.propose_pledge({ eventId: 'e1', qty: 2 }, poor);
  assert.ok(short.error);
  assert.match(short.error, /short|top up/i);
});

test('propose_pledge names the EXACT owned event, not a "Did you mean" to a buyable one', async () => {
  // Reported bug: confirming an already-owned event ("Book event event") returned "Did you mean
  // Stardust Soiree?" because the attendable pool (which excludes owned events) fuzzy-matched the
  // only buyable event. It must instead say "you already hold tickets", naming the real event.
  const events = [
    { id: 'e1', title: 'Stardust Soiree: A Night Under the Stars', status: 'early_bird', hostId: 'other', startDate: inDaysIso(5), statuses: [{ price: 15 }] },
    { id: 'e2', title: 'Book event event', status: 'early_bird', hostId: 'other', startDate: inDaysIso(5), statuses: [{ price: 10 }] },
  ];
  const profileTickets = { tickets: [{ eventId: 'e2', tab: 'upcoming', activeTicketCount: 1 }] };
  const ctx = { userId: 'u1', role: 'user', supabase: {
    rpc: async (name) => ({ data: name === 'get_profile' ? profileTickets : events, error: null }),
  } };
  const res = await EXECUTORS.propose_pledge({ eventId: 'Book event event', qty: 3 }, ctx);
  assert.ok(res.error);
  assert.match(res.error, /already hold tickets for "Book event event"/);
  assert.doesNotMatch(res.error, /Stardust|Did you mean/);
});

test('event tools resolve an event by NAME or slug, not just id', async () => {
  const events = [{ id: 'e1', title: 'Late-Night Supper Crawl', description: 'yum', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 9 }] }];
  const ctx = ctxFull({ events, user: { walletBalance: 100, cardLast4: '4242' } });
  // Details by exact name.
  const d = await EXECUTORS.get_event_details({ eventId: 'Late-Night Supper Crawl' }, ctx);
  assert.equal(d.id, 'e1');
  // Pledge using the plain-spoken name.
  const p1 = await EXECUTORS.propose_pledge({ eventId: 'late-night supper crawl', qty: 2 }, ctx);
  assert.equal(p1.proposal.eventId, 'e1');
  // Pledge using a hyphenated slug (how the model sometimes passes it).
  const p2 = await EXECUTORS.propose_pledge({ eventId: 'Late-Night-Supper-Crawl', qty: 1 }, ctx);
  assert.equal(p2.proposal.eventId, 'e1');
  // A nonsense reference still errors.
  const bad = await EXECUTORS.get_event_details({ eventId: 'totally made up event' }, ctx);
  assert.ok(bad.error);
});

test('a typo in an event name surfaces a "Did you mean" suggestion (fuzzy fallback, no embeddings)', async () => {
  const events = [{ id: 'e1', title: 'Gymming for Newbies', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 10 }] }];
  const ctx = ctxFull({ events, user: { walletBalance: 100, cardLast4: '4242' } });
  // propose_pledge with a typo'd name → asks to confirm, no proposal.
  const buy = await EXECUTORS.propose_pledge({ eventId: 'gymming for nes', qty: 1 }, ctx);
  assert.equal(buy.proposal, undefined);
  assert.match(buy.error, /did you mean/i);
  assert.match(buy.error, /Gymming for Newbies/);
  // search_events keyword miss → didYouMean instead of an empty "no events".
  const search = await EXECUTORS.search_events({ query: 'gymming for nes' }, ctx);
  assert.equal(search.count, 0);
  assert.match(search.didYouMean, /did you mean/i);
  assert.ok(search.suggestions.includes('Gymming for Newbies'));
});

test('a PARTIAL event name is confirmed, not silently auto-resolved', async () => {
  const events = [{ id: 'e1', title: 'Game night and escape rooms', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 20 }] }];
  const ctx = ctxFull({ events, user: { walletBalance: 100, cardLast4: '4242' } });
  // "game nig" is a substring of the title — must ask to confirm, not proceed.
  const buy = await EXECUTORS.propose_pledge({ eventId: 'game nig', qty: 3 }, ctx);
  assert.equal(buy.proposal, undefined);
  assert.match(buy.error, /did you mean/i);
  assert.match(buy.error, /Game night and escape rooms/);
  // The exact full name still resolves straight through.
  const exact = await EXECUTORS.propose_pledge({ eventId: 'Game night and escape rooms', qty: 1, paymentMethod: 'wallet' }, ctx);
  assert.equal(exact.proposal.eventId, 'e1');
});

test('propose_pledge honours the chosen payment method (wallet vs card) with a stable attemptId', async () => {
  const events = [{ id: 'e1', title: 'Gala', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 10 }] }];
  // Wallet: default method, balance pre-check, attemptId present.
  const walletCtx = ctxFull({ events, user: { walletBalance: 100, cardLast4: '4242' } });
  const w = await EXECUTORS.propose_pledge({ eventId: 'Gala', qty: 2, paymentMethod: 'wallet' }, walletCtx);
  assert.equal(w.proposal.payload.paymentMethod, 'wallet');
  assert.match(w.proposal.summary, /wallet/i);
  assert.ok(w.proposal.payload.attemptId);
  // Card: requires a linked card (stripePaymentMethodId); summary names the card.
  const cardCtx = ctxFull({ events, user: { walletBalance: 0, cardBrand: 'visa', cardLast4: '4242', stripePaymentMethodId: 'pm_1' } });
  const c = await EXECUTORS.propose_pledge({ eventId: 'Gala', qty: 1, paymentMethod: 'card' }, cardCtx);
  assert.equal(c.proposal.payload.paymentMethod, 'card');
  assert.match(c.proposal.summary, /ending 4242/i);
  // Card chosen but none linked → guidance, no proposal.
  const noCardCtx = ctxFull({ events, user: { walletBalance: 0, cardLast4: null, stripePaymentMethodId: null } });
  const nc = await EXECUTORS.propose_pledge({ eventId: 'Gala', qty: 1, paymentMethod: 'card' }, noCardCtx);
  assert.equal(nc.proposal, undefined);
  assert.match(nc.error, /card/i);
});

test('admin accounts cannot receive pledge proposals', async () => {
  const events = [{ id: 'e1', title: 'Public Gig', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 10 }] }];
  const ctx = {
    userId: 'admin1',
    role: 'admin',
    supabase: { rpc: async (name) => ({ data: name === 'get_profile' ? { tickets: [] } : events, error: null }) },
  };
  const listed = await EXECUTORS.list_available_events({}, ctx);
  assert.equal(listed.count, 0);
  const proposed = await EXECUTORS.propose_pledge({ eventId: 'e1', qty: 1 }, ctx);
  assert.match(proposed.error, /Admin accounts cannot attend/);
});

test('event action tools resolve natural references semantically and ask when ambiguous', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  __setEmbedForTests(async () => [0.1, 0.2, 0.3]);
  const events = [
    { id: 'e1', title: 'Retro Arcade & Esports Night', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 9 }] },
    { id: 'e2', title: 'Wine Appreciation & Wind-Down', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 14 }] },
  ];
  const ctx = {
    ...ctxFull({ events, user: { walletBalance: 100, cardLast4: '4242' } }),
    supabase: {
      ...ctxFull({ events, user: { walletBalance: 100, cardLast4: '4242' } }).supabase,
      rpc: async (name) => {
        if (name === 'get_profile') return { data: { tickets: [] }, error: null };
        if (name === 'match_events' || name === 'match_events_hybrid') return { data: [{ eventId: 'e1', similarity: 0.91 }, { eventId: 'e2', similarity: 0.2 }], error: null };
        return { data: events, error: null };
      },
    },
  };

  // A non-exact reference is NEVER auto-resolved — the closest embedding match is
  // surfaced as a "Did you mean …?" the user must confirm before anything happens.
  const suggest = await EXECUTORS.propose_pledge({ eventId: 'the esports one', qty: 1 }, ctx);
  assert.equal(suggest.proposal, undefined);
  assert.match(suggest.error, /did you mean/i);
  assert.match(suggest.error, /Retro Arcade & Esports Night/i);

  const ambiguous = {
    ...ctx,
    supabase: {
      ...ctx.supabase,
      rpc: async (name) => {
        if (name === 'get_profile') return { data: { tickets: [] }, error: null };
        if (name === 'match_events' || name === 'match_events_hybrid') return { data: [{ eventId: 'e1', similarity: 0.84 }, { eventId: 'e2', similarity: 0.81 }], error: null };
        return { data: events, error: null };
      },
    },
  };
  const ask = await EXECUTORS.get_event_details({ eventId: 'the night event' }, ambiguous);
  assert.match(ask.error, /did you mean/i);
});

test('propose_cancel_event proposes a refund/cancel for own event only, reason optional', async () => {
  const own = [{ id: 'e1', title: 'My Gig', status: 'greenlit', hostId: 'u1', statuses: [] }];
  const ok = await EXECUTORS.propose_cancel_event({ eventId: 'e1', reason: 'venue fell through' }, ctxWith(own));
  assert.equal(ok.proposal.action, 'cancel_event');
  assert.match(ok.proposal.summary, /refunded/i);
  // Any informal reason is accepted as-is.
  const informal = await EXECUTORS.propose_cancel_event({ eventId: 'e1', reason: 'it is not nice' }, ctxWith(own));
  assert.match(informal.proposal.summary, /it is not nice/);
  // No reason at all → still a proposal (reason is optional), noting none was given.
  const noReason = await EXECUTORS.propose_cancel_event({ eventId: 'e1' }, ctxWith(own));
  assert.equal(noReason.proposal.action, 'cancel_event');
  assert.match(noReason.proposal.summary, /no reason given/i);
  const notMine = [{ id: 'e1', title: 'Theirs', status: 'greenlit', hostId: 'other', statuses: [] }];
  const blocked = await EXECUTORS.propose_cancel_event({ eventId: 'e1' }, ctxWith(notMine));
  assert.ok(blocked.error);
});

test('propose_delete_draft proposes deleting an existing draft only', async () => {
  const ctx = ctxFull({ drafts: [{ id: 'd1', title: 'Draft One' }] });
  const ok = await EXECUTORS.propose_delete_draft({ draftId: 'd1' }, ctx);
  assert.equal(ok.proposal.action, 'delete_draft');
  assert.equal(ok.proposal.payload.draftId, 'd1');
  const missing = await EXECUTORS.propose_delete_draft({ draftId: 'nope' }, ctx);
  assert.ok(missing.error);
});

test('propose_edit_draft proposes editing an existing draft, needs a field, errors if missing', async () => {
  const ctx = ctxFull({ drafts: [{ id: 'd1', title: 'My Draft', location: 'Hall' }] });
  const ok = await EXECUTORS.propose_edit_draft({ draftId: 'd1', earlyPrice: 8 }, ctx);
  assert.equal(ok.proposal.action, 'edit_draft');
  assert.equal(ok.proposal.payload.draftId, 'd1');
  assert.equal(ok.proposal.payload.updates.earlyPrice, 8);
  const noFields = await EXECUTORS.propose_edit_draft({ draftId: 'd1' }, ctx);
  assert.ok(noFields.error);
  const missing = await EXECUTORS.propose_edit_draft({ draftId: 'nope', title: 'X' }, ctx);
  assert.ok(missing.error);
});

test('draft tools resolve natural references semantically and ask when ambiguous', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  __setEmbedForTests(async () => [0.1, 0.2, 0.3]);
  const drafts = [
    { id: 'd1', title: 'Founders Networking Night', description: 'meet startup founders', location: 'SMU Hall' },
    { id: 'd2', title: 'Wine Social', description: 'wine appreciation', location: 'Lounge' },
  ];
  const base = ctxFull({ drafts });
  const ctx = {
    ...base,
    supabase: {
      ...base.supabase,
      rpc: async (name) => {
        if (name === 'match_event_drafts') return { data: [{ draftId: 'd1', similarity: 0.9 }, { draftId: 'd2', similarity: 0.3 }], error: null };
        return { data: [], error: null };
      },
    },
  };

  const listed = await EXECUTORS.list_my_drafts({ query: 'the networking draft' }, ctx);
  assert.equal(listed.drafts[0].id, 'd1');
  const edit = await EXECUTORS.propose_edit_draft({ draftId: 'the founder draft', earlyPrice: 8 }, ctx);
  assert.equal(edit.proposal.payload.draftId, 'd1');

  const ambiguous = {
    ...ctx,
    supabase: {
      ...ctx.supabase,
      rpc: async (name) => {
        if (name === 'match_event_drafts') return { data: [{ draftId: 'd1', similarity: 0.84 }, { draftId: 'd2', similarity: 0.82 }], error: null };
        return { data: [], error: null };
      },
    },
  };
  const ask = await EXECUTORS.propose_delete_draft({ draftId: 'the social draft' }, ambiguous);
  assert.match(ask.error, /more than one matching draft/i);
});

test('executeAction edit_draft re-saves the merged draft payload', async () => {
  const draftId = '11111111-1111-1111-1111-111111111111';
  let saved = null;
  const sb = {
    from: (table) => {
      if (table === 'EVENT_DRAFTS') {
        return {
          select: () => ({ order: async () => ({ data: [{ id: draftId, payload: { title: 'Old', location: 'Hall', statuses: [{ statusName: 'early_bird', price: 5, qty: 10 }, { statusName: 'greenlit', price: 8, qty: 20 }] } }], error: null }) }),
          update: (vals) => ({ eq: () => ({ select: () => ({ single: async () => { saved = vals; return { data: { id: draftId, payload: vals.payload }, error: null }; } }) }) }),
        };
      }
      return { select: () => ({}) };
    },
  };
  const out = await executeAction({ sb, user: { id: 'u1' }, action: 'edit_draft', payload: { draftId, updates: { title: 'New', earlyPrice: 3 } } });
  assert.equal(out.status, 'ok');
  assert.equal(saved.payload.title, 'New');
  assert.equal(saved.payload.statuses.find((s) => s.statusName === 'early_bird').price, 3);
});

test('executeAction create_event_draft returns a publish follow-up and publish_draft creates the event', async () => {
  const drafts = [];
  let deletedDraft = null;
  let createArgs = null;
  const sb = {
    rpc: async (name, args) => {
      if (name === 'create_event') {
        createArgs = args;
        return { data: { eventId: 'e1' }, error: null };
      }
      return { data: null, error: null };
    },
    from: (table) => {
      if (table === 'EVENT_DRAFTS') {
        return {
          insert: (vals) => ({
            select: () => ({
              single: async () => {
                const row = { id: 'd1', payload: vals.payload };
                drafts.unshift(row);
                return { data: row, error: null };
              },
            }),
          }),
          select: () => ({ order: async () => ({ data: drafts, error: null }) }),
          delete: () => ({ eq: async (_col, id) => { deletedDraft = id; return { error: null }; } }),
        };
      }
      if (table === 'USER') return { select: () => ({ eq: () => ({ single: async () => ({ data: { email: null, username: 'org' }, error: null }) }) }) };
      return { select: () => ({}) };
    },
  };

  const draft = await executeAction({
    sb,
    user: { id: 'u1', role: 'organiser' },
    action: 'create_event_draft',
    payload: {
      title: 'Future Mixer',
      description: 'Skills and social',
      venue: 'SMU Hall',
      startDate: inDaysIso(10),
      endDate: inDaysIso(10),
      deadline: inDaysIso(5),
      earlyPrice: 10,
      greenlitPrice: 20,
      hypeThreshold: 10,
      capacity: 50,
    },
  });
  assert.equal(draft.status, 'ok');
  assert.equal(draft.nextProposal.action, 'publish_draft');
  assert.equal(draft.nextProposal.payload.draftId, 'd1');

  const published = await executeAction({
    sb,
    user: { id: 'u1', role: 'organiser' },
    action: 'publish_draft',
    payload: { draftId: 'd1' },
  });
  assert.equal(published.status, 'ok');
  assert.equal(published.eventId, 'e1');
  assert.equal(createArgs.p_title, 'Future Mixer');
  assert.equal(deletedDraft, 'd1');
});

test('normal users cannot create draft events through confirmed AI actions', async () => {
  const out = await executeAction({
    sb: {},
    user: { id: 'u1', role: 'user' },
    action: 'create_event_draft',
    payload: { title: 'Nope' },
  });
  assert.equal(out.error, 'not_organiser');
});

test('get_wallet returns balance, card and recent transactions', async () => {
  const out = await EXECUTORS.get_wallet({}, ctxFull({ user: { walletBalance: 42, cardBrand: 'visa', cardLast4: '4242' } }));
  assert.equal(out.balance, 42);
  assert.deepEqual(out.card, { brand: 'visa', last4: '4242' });
  assert.ok(Array.isArray(out.recentTransactions));
});

test('AGENT_TOOLS exposes all 29 tools as tool()+zod objects, invokable end-to-end', async () => {
  assert.equal(AGENT_TOOLS.length, 29);
  const names = AGENT_TOOLS.map((t) => t.name).sort();
  assert.ok(names.includes('search_events') && names.includes('propose_topup') && names.includes('get_wallet'));
  assert.ok(names.includes('suggest_operational_costs'));
  assert.ok(names.includes('list_live_events') && names.includes('get_app_info'));
  assert.ok(names.includes('get_weather') && names.includes('research_event_ideas'));
  assert.ok(names.includes('get_current_date') && names.includes('propose_give_away_tickets'));
  assert.ok(names.includes('get_event_attendees') && names.includes('propose_edit_draft'));
  assert.ok(names.includes('recommend_events') && names.includes('semantic_search_events') && names.includes('find_similar_events') && names.includes('get_similar_past_events'));
  // Every entry is a StructuredTool with a zod schema.
  assert.ok(AGENT_TOOLS.every((t) => typeof t.invoke === 'function' && t.schema));

  // Invoke a tool through the LangChain wrapper: ctx flows via config.configurable and
  // the result is the JSON-stringified executor output.
  const ctx = ctxFull({ user: { walletBalance: 42, cardBrand: 'visa', cardLast4: '4242' } });
  const raw = await TOOLS_BY_NAME.get_wallet.invoke({}, { configurable: { ctx } });
  assert.equal(JSON.parse(raw).balance, 42);
});

// ── Weather + web-research tools ─────────────────────────────────────────────
// A forecast day (Weather API shape) for a Singapore calendar date.
const sgYmd = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const forecastDay = (ymd, percent) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return { displayDate: { year: y, month: m, day: d }, daytimeForecast: { precipitation: { probability: { percent } } }, nighttimeForecast: { precipitation: { probability: { percent: 0 } } } };
};
const inDaysIso = (n) => `${sgYmd(new Date(Date.now() + n * 86400000).toISOString())}T19:00:00+08:00`;

test('get_weather warns when an event day is over 70% rain, resolving the event date by id', async () => {
  const startISO = inDaysIso(3);
  __setForecastForTests(async () => [forecastDay(sgYmd(startISO), 90)]);
  const events = [{ id: 'e1', title: 'Picnic', status: 'early_bird', hostId: 'u1', startDate: startISO, endDate: startISO, statuses: [{ price: 5 }] }];
  const out = await EXECUTORS.get_weather({ eventId: 'e1' }, ctxWith(events));
  assert.equal(out.status, 'ok');
  assert.equal(out.willRain, true);
  assert.equal(out.precipitationProbability, 90);
});

test('get_weather stays quiet when the forecast is fine', async () => {
  const start = inDaysIso(2);
  __setForecastForTests(async () => [forecastDay(sgYmd(start), 20)]);
  const out = await EXECUTORS.get_weather({ start }, ctxWith([]));
  assert.equal(out.status, 'ok');
  assert.equal(out.willRain, false);
});

// The reported bug: the bot refused IN-RANGE dates as "too far in the future", and even
// called TOMORROW too far away. `beyond_horizon` was inferred from "no forecast day matched"
// rather than from comparing dates, so a short/empty provider response looked identical to a
// date past the horizon. These pin the two apart.
test('a date INSIDE the horizon is never called "too far away" when the forecast is short', async () => {
  // Only 5 days returned (the provider's default page size) but the ask is 9 days out — the
  // date is well within the 10-day horizon, so this must NOT claim it is too far away.
  __setForecastForTests(async () => [0, 1, 2, 3, 4].map((n) => forecastDay(sgYmd(inDaysIso(n)), 10)));
  const out = await EXECUTORS.get_weather({ start: inDaysIso(9) }, ctxWith([]));
  assert.notEqual(out.status, 'beyond_horizon');
  assert.equal(out.status, 'unavailable');
  assert.doesNotMatch(out.summary, /days away|too far/i);
});

test('an empty forecast for TOMORROW reports unavailable, not "more than 10 days away"', async () => {
  __setForecastForTests(async () => []);
  const out = await EXECUTORS.get_weather({ start: inDaysIso(1) }, ctxWith([]));
  assert.equal(out.status, 'unavailable');
  assert.doesNotMatch(out.summary, /days away|too far/i);
});

test('a date genuinely past the horizon still reports beyond_horizon', async () => {
  // A full 10-day forecast; the ask is 11 days out. Decided by date, not by absence of data.
  __setForecastForTests(async () => [...Array(10).keys()].map((n) => forecastDay(sgYmd(inDaysIso(n)), 10)));
  const out = await EXECUTORS.get_weather({ start: inDaysIso(11) }, ctxWith([]));
  assert.equal(out.status, 'beyond_horizon');
  assert.match(out.summary, /too far out/i);
});

test('a date at the far edge of the horizon is answered, not refused', async () => {
  __setForecastForTests(async () => [...Array(11).keys()].map((n) => forecastDay(sgYmd(inDaysIso(n)), 80)));
  const out = await EXECUTORS.get_weather({ start: inDaysIso(10) }, ctxWith([]));
  assert.equal(out.status, 'ok');
  assert.equal(out.willRain, true);
});

test('research_event_ideas returns structured suggestions from the (mocked) web search', async () => {
  __setResearchCallForTests(async () => JSON.stringify({
    trends: ['run clubs', 'matcha'],
    suggestedName: 'Sunrise Run & Matcha Social',
    suggestedDescription: 'A dawn 5k followed by matcha and mingling.',
    rationale: 'Taps the wellness + run-club trend among students.',
    suggestedLocation: 'East Coast Park, near SMU',
  }));
  const out = await EXECUTORS.research_event_ideas({ theme: 'wellness' }, ctxFull({ user: { university: 'SMU' } }));
  assert.equal(out.source, 'web');
  assert.equal(out.suggestedName, 'Sunrise Run & Matcha Social');
  assert.deepEqual(out.trends, ['run clubs', 'matcha']);
  assert.match(out.suggestedLocation, /SMU/);
});

test('get_current_date reports today in Singapore', async () => {
  const out = await EXECUTORS.get_current_date({}, ctxWith([]));
  const todaySg = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  assert.equal(out.date, todaySg);
  assert.match(out.timezone, /Singapore/);
});

test('get_app_info returns the knowledge base covering the signup bonus and top-up cap', async () => {
  // The tool must surface the app facts the agent kept refusing to answer (signup bonus, top-up
  // cap) so a "how does the app work" question can be grounded on real text, not the model guessing.
  // Embeddings are off in this suite (no GEMINI_API_KEY), so retrieveDocChunks returns null and
  // this exercises the whole-doc FALLBACK path; the RAG retrieval path is covered in docKnowledge.test.js.
  const out = await EXECUTORS.get_app_info({}, ctxWith([]));
  assert.match(out.reference, /signup bonus/i);
  assert.match(out.reference, /\$20/);
  assert.match(out.reference, /\$200 per transaction/i);
});

// ── Give-away tickets tool ───────────────────────────────────────────────────
// ctx whose get_profile RPC returns the caller's ticket holdings, get_events the events.
const giveAwayCtx = (tickets, events = []) => ({
  userId: 'u1', role: 'user',
  supabase: { rpc: async (name) => ({ data: name === 'get_profile' ? { tickets } : events, error: null }) },
});

test('propose_give_away_tickets proposes releasing N of the held tickets', async () => {
  const ctx = giveAwayCtx(
    [{ bookingId: '5', eventId: 'e1', activeTicketCount: 3, tab: 'upcoming' }],
    [{ id: 'e1', title: 'Live Gig', hostId: 'org1', status: 'greenlit' }],
  );
  const out = await EXECUTORS.propose_give_away_tickets({ eventId: 'e1', qty: 2 }, ctx);
  assert.equal(out.proposal.action, 'give_away');
  assert.equal(out.proposal.payload.bookingId, '5');
  assert.equal(out.proposal.payload.qty, 2);
  assert.match(out.proposal.summary, /2 of your 3/);
});

test('propose_give_away_tickets rejects giving away more than held', async () => {
  const ctx = giveAwayCtx([{ bookingId: '5', eventId: 'e1', activeTicketCount: 3, tab: 'upcoming' }], [{ id: 'e1', title: 'Gig' }]);
  const out = await EXECUTORS.propose_give_away_tickets({ eventId: 'e1', qty: 9 }, ctx);
  assert.match(out.error, /only hold 3/);
});

test('propose_give_away_tickets errors when the user holds none for that event', async () => {
  const ctx = giveAwayCtx(
    [{ bookingId: '5', eventId: 'other', activeTicketCount: 1, tab: 'upcoming' }],
    [{ id: 'e1', title: 'Gig', hostId: 'org1', status: 'greenlit' }],
  );
  const out = await EXECUTORS.propose_give_away_tickets({ eventId: 'e1', qty: 1 }, ctx);
  assert.match(out.error, /do not hold/);
});

test('get_my_joined_events groups by tab with ticket counts', async () => {
  const events = [
    { id: 'e1', title: 'Upcoming Gig', status: 'greenlit', hostId: 'other', statuses: [{ price: 10 }] },
    { id: 'e2', title: 'Past Show', status: 'completed', hostId: 'other', statuses: [{ price: 8 }] },
  ];
  const tickets = [
    { eventId: 'e1', activeTicketCount: 2, tab: 'upcoming' },
    { eventId: 'e2', activeTicketCount: 1, tab: 'past' },
  ];
  const ctx = { userId: 'u1', role: 'user', supabase: { rpc: async (name) => ({ data: name === 'get_profile' ? { tickets } : events, error: null }) } };
  const out = await EXECUTORS.get_my_joined_events({}, ctx);
  assert.equal(out.counts.upcoming, 1);
  assert.equal(out.upcoming[0].title, 'Upcoming Gig');
  assert.equal(out.upcoming[0].ticketsHeld, 2);
  assert.equal(out.past[0].ticketsHeld, 1);
});

test('get_event_attendees returns the attendee count and names', async () => {
  const events = [{ id: 'e1', title: 'Gig', status: 'greenlit', hostId: 'u1', statuses: [] }];
  const attendees = [{ name: 'Alice', username: 'alice' }, { name: 'Bob', username: 'bob' }];
  const ctx = { userId: 'u1', role: 'user', supabase: { rpc: async (name) => ({ data: name === 'get_event_attendees' ? attendees : events, error: null }) } };
  const out = await EXECUTORS.get_event_attendees({ eventId: 'e1' }, ctx);
  assert.equal(out.attendeeCount, 2);
  assert.equal(out.attendees[0].name, 'Alice');
});

// ── Hype-pricing draft creation ──────────────────────────────────────────────
test('propose_create_event supports hype pricing (base < max)', async () => {
  const args = { title: 'Rooftop Rave', startDate: '2026-09-01T19:00:00+08:00', endDate: '2026-09-01T23:00:00+08:00', deadline: '2026-08-25T23:59:00+08:00', pricingModel: 'hype', basePrice: 10, maxPrice: 25 };
  const out = await EXECUTORS.propose_create_event(args, { ...ctxWith([]), role: 'organiser' });
  assert.equal(out.proposal.action, 'create_event_draft');
  assert.equal(out.proposal.payload.pricingModel, 'hype');
  assert.match(out.proposal.summary, /hype pricing \$10\.00→\$25\.00/);
});

test('propose_create_event rejects hype pricing when max is not above base', async () => {
  const args = { title: 'X', startDate: '2026-09-01T19:00:00+08:00', endDate: '2026-09-01T23:00:00+08:00', deadline: '2026-08-25T23:59:00+08:00', pricingModel: 'hype', basePrice: 20, maxPrice: 10 };
  const out = await EXECUTORS.propose_create_event(args, { ...ctxWith([]), role: 'organiser' });
  assert.match(out.error, /maxPrice must be higher/);
});

// ── Semantic (vector) tools ──────────────────────────────────────────────────
test('recommend_events ranks attendable events by semantic similarity', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  __setEmbedForTests(async () => [0.1, 0.2, 0.3]);
  try {
    const events = [
      { id: 'e1', title: 'Retro Arcade & Esports Night', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 9 }] },
      { id: 'e2', title: 'Wine Appreciation', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 14 }] },
    ];
    const ctx = {
      userId: 'u1', role: 'user',
      supabase: { rpc: async (name) => {
        if (name === 'get_profile') return { data: { tickets: [] }, error: null };
        if (name === 'match_events' || name === 'match_events_hybrid') return { data: [{ eventId: 'e1', similarity: 0.92 }, { eventId: 'e2', similarity: 0.31 }], error: null };
        return { data: events, error: null };
      } },
    };
    const out = await EXECUTORS.recommend_events({ interests: 'gaming' }, ctx);
    assert.equal(out.semantic, true);
    assert.equal(out.events[0].id, 'e1'); // arcade/esports ranks first for "gaming"
  } finally {
    __resetEmbedForTests();
    delete process.env.GEMINI_API_KEY;
  }
});

test('get_similar_past_events returns historical benchmark rows without ids', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  __setEmbedForTests(async () => [0.1, 0.2, 0.3]);
  const ctx = {
    userId: 'u1',
    role: 'organiser',
    supabase: {
      rpc: async (name) => {
        if (name === 'match_similar_past_events') {
          return { data: [{ eventId: 'old1', title: 'Past Networking Mixer', sold: 45, capacity: 60, similarity: 0.88 }], error: null };
        }
        return { data: [], error: null };
      },
    },
  };
  const out = await EXECUTORS.get_similar_past_events({ query: 'networking night', count: 3 }, ctx);
  assert.equal(out.semantic, true);
  assert.equal(out.events[0].title, 'Past Networking Mixer');
  assert.equal(out.events[0].sellThroughPct, 75);
  assert.equal(out.events[0].eventId, undefined);
});

test('recommend_events falls back to cheapest when embeddings are unavailable', async () => {
  delete process.env.GEMINI_API_KEY; // embeddings off
  const events = [
    { id: 'e1', title: 'Pricey', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 20 }] },
    { id: 'e2', title: 'Cheap', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 5 }] },
  ];
  const ctx = { userId: 'u1', role: 'user', supabase: { rpc: async (name) => ({ data: name === 'get_profile' ? { tickets: [] } : events, error: null }) } };
  const out = await EXECUTORS.recommend_events({ interests: 'anything' }, ctx);
  assert.equal(out.semantic, false);
  assert.equal(out.events[0].id, 'e2'); // cheapest first
});

// ── Scope guard (off-topic filter) ───────────────────────────────────────────
test('off-topic questions are refused by the guard before any branch runs', async () => {
  useModel();
  __setGuardForTests(async () => false);
  let branchCalled = false;
  __setAgentsForTests(() => allBranches({ invoke: async ({ messages }) => { branchCalled = true; return { messages }; } }));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'what is 2+2?' }], ctx: ctxWith([]) });
  assert.equal(out.reply, OFF_TOPIC_REPLY);
  assert.equal(branchCalled, false);
});

test('scope guard judges ONLY the latest user message (not prior on-topic turns)', async () => {
  useModel(); useClassify('read_only'); useAgents(fakeAgent([say('ok')]));
  let seen = null;
  __setGuardForTests(async (text) => { seen = text; return true; });
  await runGraph({
    system: 's',
    messages: [
      { role: 'user', content: 'what are the cheapest events?' },
      { role: 'assistant', content: 'Here are a few.' },
      { role: 'user', content: 'what should I wear tonight?' },
    ],
    ctx: ctxWith([]),
  });
  assert.equal(seen, 'what should I wear tonight?');
});

test('a terse "how about X?" after an on-topic turn is NOT refused as off-topic', async () => {
  // The reported bug: "how about gymming for newbies?" got the off-topic refusal because the
  // scope guard judged the bare string (reads as a gym question). A comparative follow-up after
  // an on-topic assistant turn must continue the flow. Guard stubbed to REFUSE everything, so a
  // non-refusal proves the continuation bypass fired WITHOUT consulting the guard.
  __setGuardForTests(async () => false);
  useModel(); useClassify('read_only'); useAgents(fakeAgent([say('branch-ran')]));
  for (const followup of ['how about gymming for newbies?', 'what about the frisbee one?', 'and the next one?']) {
    const out = await runGraph({
      system: 's',
      messages: [
        { role: 'assistant', content: 'Grad Ball: Black-Tie Gala is sold out and the deadline to buy tickets has passed, so you cannot join it.' },
        { role: 'user', content: followup },
      ],
      ctx: ctxWith([]),
    });
    assert.notEqual(out.reply, OFF_TOPIC_REPLY, `"${followup}" must not be refused`);
  }
});

test('a comparative follow-up in a COLD conversation still reaches the guard', async () => {
  // The bypass requires the PREVIOUS assistant turn to be on-topic. With no such turn,
  // "how about pizza?" is judged normally — here the guard refuses it.
  __setGuardForTests(async () => false);
  useModel(); useAgents(fakeAgent([say('should-not-run')]));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'how about pizza?' }], ctx: ctxWith([]) });
  assert.equal(out.reply, OFF_TOPIC_REPLY);
});

test('guardAllows lets short/continuation answers through, still blocks off-topic questions', () => {
  // Short answers to the agent's own question (e.g. "how many tickets?") must pass.
  assert.equal(guardAllows('3'), true);
  assert.equal(guardAllows('3 tickets'), true);
  assert.equal(guardAllows('card'), true);
  assert.equal(guardAllows('wallet'), true);
  assert.equal(guardAllows('yes'), true);
  // Questions about the app itself (pages/sections/FAQ/testimonials) are always in-scope.
  assert.equal(guardAllows('is there a testimonials section?'), true);
  assert.equal(guardAllows('is there a what students say section?'), true);
  assert.equal(guardAllows('is there an FAQ?'), true);
  // A full off-topic question is NOT fast-pathed (falls through to the LLM guard).
  assert.equal(guardAllows('what is 2+2?'), false);
  assert.equal(guardAllows('write me a poem about cats'), false);
});

test('on-topic questions pass the guard through to a branch', async () => {
  useModel(); useClassify('discovery'); __setGuardForTests(async () => true);
  useAgents(fakeAgent([say('Here are some events for you.')]));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'show me events' }], ctx: ctxWith([]) });
  assert.match(out.reply, /events/i);
});

// ── New executeAction branches (deterministic, re-validated) ─────────────────
test('executeAction give_away releases tickets via the give-away service', async () => {
  let called = null;
  const sb = { rpc: async (name, args) => {
    if (name === 'give_away_tickets') { called = args; return { data: { status: 'ok' }, error: null }; }
    if (name === 'get_events') return { data: [], error: null };
    if (name === 'get_profile') return { data: { tickets: [] }, error: null };
    return { data: null, error: null };
  } };
  // eventIdForBooking reads BOOKINGS; stub .from().select().eq().single().
  sb.from = () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { eventId: 'e1' }, error: null }) }) }) });
  const out = await executeAction({ sb, user: { id: 'u1' }, action: 'give_away', payload: { bookingId: '5', qty: 2 } });
  assert.equal(out.status, 'ok');
  assert.equal(called.p_booking_id, 5);
  assert.equal(called.p_quantity, 2);
});

test('executeAction topup fails safe when Stripe is not configured', async () => {
  const out = await executeAction({ sb: {}, user: { id: 'u1' }, action: 'topup', payload: { amount: 20 } });
  assert.equal(out.error, 'stripe_disabled');
});

test('executeAction pledge surfaces insufficient_funds from the RPC', async () => {
  const sb = { rpc: async () => ({ data: { error: 'insufficient_funds' }, error: null }) };
  const out = await executeAction({ sb, user: { id: 'u1' }, action: 'pledge', eventId: 'e1', payload: { qty: 1 } });
  assert.equal(out.error, 'insufficient_funds');
});

test('executeAction delete_draft rejects an unknown draft, cancel_event rejects non-owners', async () => {
  const draftSb = { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) };
  const noDraft = await executeAction({ sb: draftSb, user: { id: 'u1' }, action: 'delete_draft', payload: { draftId: 'd1' } });
  assert.equal(noDraft.error, 'not_found');

  const cancelSb = { rpc: async () => ({ data: [{ id: 'e1', hostId: 'other' }], error: null }) };
  const notOwner = await executeAction({ sb: cancelSb, user: { id: 'u1' }, action: 'cancel_event', eventId: 'e1', payload: {} });
  assert.equal(notOwner.error, 'not_owner');
});

test('remember tool stores a durable fact and skips duplicates', async () => {
  const rows = [];
  const ctx = {
    userId: 'u1',
    role: 'user',
    supabase: {
      from: () => ({
        select: () => ({ order: () => ({ limit: () => ({ eq: async () => ({ data: rows, error: null }) }) }) }),
        insert: (row) => {
          const saved = { id: rows.length + 1, ...row };
          rows.push(saved);
          return { select: () => ({ single: async () => ({ data: { id: saved.id }, error: null }) }) };
        },
      }),
    },
  };
  const first = await EXECUTORS.remember({ fact: 'Loves live music', category: 'interest' }, ctx);
  assert.equal(first.status, 'ok');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, 'u1');
  const dup = await EXECUTORS.remember({ fact: 'loves live music' }, ctx); // case-insensitive dupe
  assert.equal(dup.note, 'already remembered');
  assert.equal(rows.length, 1);
});

