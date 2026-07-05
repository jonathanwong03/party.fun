import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { __resetProvidersForTests } from '../modelRouter.js';
import { runGraph, resumeGraph, classifyIntent, BRANCH_TOOLS, OFF_TOPIC_REPLY, __setBuildModelForTests, __setAgentsForTests, __setClassifyForTests, __setGuardForTests, __resetGraphForTests } from './eventGraph.js';
import { EXECUTORS, AGENT_TOOLS, TOOLS_BY_NAME } from './tools.js';
import { executeAction } from './actions.js';
import { selectAtRisk } from './advisor.js';
import { __setForecastForTests, __resetForecastForTests } from '../../weatherService.js';
import { __setResearchCallForTests, __resetResearchCallForTests } from './research.js';

afterEach(() => { __resetProvidersForTests(); __resetGraphForTests(); __resetForecastForTests(); __resetResearchCallForTests(); });

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

const ctxWith = (events) => ({
  userId: 'u1',
  role: 'user',
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

test('classify routes to the matching branch agent', async () => {
  useModel(); useClassify('event_mgmt');
  __setAgentsForTests(() => ({
    read_only: fakeAgent([say('answer-branch')]),
    discovery: fakeAgent([say('discovery-branch')]),
    best_fit: fakeAgent([say('bestfit-branch')]),
    event_mgmt: fakeAgent([say('manage-branch')]),
    transaction: fakeAgent([say('transact-branch')]),
  }));
  const out = await runGraph({ system: 's', messages: [{ role: 'user', content: 'edit my event' }], ctx: ctxWith([]) });
  assert.match(out.reply, /manage-branch/);
});

test('branch toolsets are scoped (only management/transaction expose write proposals)', () => {
  assert.ok(BRANCH_TOOLS.transaction.includes('propose_topup'));
  assert.ok(BRANCH_TOOLS.event_mgmt.includes('propose_cancel_event'));
  assert.ok(!BRANCH_TOOLS.read_only.some((t) => t.startsWith('propose_')));
  assert.ok(!BRANCH_TOOLS.discovery.some((t) => t.startsWith('propose_')));
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

test('auto mode executes inline; autonomous surfaces proposals without interrupting', async () => {
  useModel(); useClassify('transaction');
  useAgents(fakeAgent([toolMsg({ proposal: topupProposal }, 'propose_topup'), say('Proposed.')]));
  const ctx = ctxWith([]);

  const auto = await runGraph({ system: 's', messages: [{ role: 'user', content: 'top up $20' }], ctx, mode: 'auto' });
  assert.equal(auto.status, 'done');
  assert.equal(auto.results.length, 1);

  const adv = await runGraph({ system: 's', messages: [{ role: 'user', content: 'top up $20' }], ctx, autonomous: true });
  assert.equal(adv.status, 'done');
  assert.deepEqual(adv.proposals.map((p) => p.action), ['topup']);
  assert.equal(adv.results.length, 0);
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
  const out = await EXECUTORS.propose_create_event({ title: 'Rooftop Jam', venue: 'SoR', earlyPrice: 10, ...dates }, ctxWith([]));
  assert.equal(out.proposal.action, 'create_event_draft');
  assert.equal(out.proposal.eventId, null);
  assert.equal(out.proposal.payload.title, 'Rooftop Jam');
  assert.equal(out.proposal.payload.startDate, dates.startDate);

  const noTitle = await EXECUTORS.propose_create_event({ ...dates, title: '  ' }, ctxWith([]));
  assert.ok(noTitle.error);
  const noDates = await EXECUTORS.propose_create_event({ title: 'Dateless' }, ctxWith([]));
  assert.match(noDates.error, /deadline/i);
});

test('list_available_events excludes own, purchased and already-started events', async () => {
  const events = [
    { id: 'e1', title: 'Buyable', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 10 }] },
    { id: 'e2', title: 'Mine', status: 'early_bird', hostId: 'u1', startDate: inDaysIso(3), statuses: [{ price: 5 }] },
    { id: 'e3', title: 'Already bought', status: 'early_bird', hostId: 'other', startDate: inDaysIso(3), statuses: [{ price: 8 }] },
    { id: 'e4', title: 'Already started', status: 'early_bird', hostId: 'other', startDate: inDaysIso(-1), statuses: [{ price: 7 }] },
  ];
  // get_profile.myEventIds marks e3 as already purchased (matches the UI's source).
  const ctx = {
    userId: 'u1',
    role: 'user',
    supabase: { rpc: async (name) => ({ data: name === 'get_profile' ? { myEventIds: ['e3'] } : events, error: null }) },
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

test('propose_cancel_event proposes a refund/cancel for own event only', async () => {
  const own = [{ id: 'e1', title: 'My Gig', status: 'greenlit', hostId: 'u1', statuses: [] }];
  const ok = await EXECUTORS.propose_cancel_event({ eventId: 'e1', reason: 'venue fell through' }, ctxWith(own));
  assert.equal(ok.proposal.action, 'cancel_event');
  assert.match(ok.proposal.summary, /refunded/i);
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

test('get_wallet returns balance, card and recent transactions', async () => {
  const out = await EXECUTORS.get_wallet({}, ctxFull({ user: { walletBalance: 42, cardBrand: 'visa', cardLast4: '4242' } }));
  assert.equal(out.balance, 42);
  assert.deepEqual(out.card, { brand: 'visa', last4: '4242' });
  assert.ok(Array.isArray(out.recentTransactions));
});

test('AGENT_TOOLS exposes all 22 tools as tool()+zod objects, invokable end-to-end', async () => {
  assert.equal(AGENT_TOOLS.length, 22);
  const names = AGENT_TOOLS.map((t) => t.name).sort();
  assert.ok(names.includes('search_events') && names.includes('propose_topup') && names.includes('get_wallet'));
  assert.ok(names.includes('get_weather') && names.includes('research_event_ideas'));
  assert.ok(names.includes('get_current_date') && names.includes('propose_give_away_tickets'));
  assert.ok(names.includes('get_event_attendees') && names.includes('propose_edit_draft'));
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
  const ctx = giveAwayCtx([{ bookingId: '5', eventId: 'other', activeTicketCount: 1, tab: 'upcoming' }], []);
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
  const out = await EXECUTORS.propose_create_event(args, ctxWith([]));
  assert.equal(out.proposal.action, 'create_event_draft');
  assert.equal(out.proposal.payload.pricingModel, 'hype');
  assert.match(out.proposal.summary, /hype pricing \$10\.00→\$25\.00/);
});

test('propose_create_event rejects hype pricing when max is not above base', async () => {
  const args = { title: 'X', startDate: '2026-09-01T19:00:00+08:00', endDate: '2026-09-01T23:00:00+08:00', deadline: '2026-08-25T23:59:00+08:00', pricingModel: 'hype', basePrice: 20, maxPrice: 10 };
  const out = await EXECUTORS.propose_create_event(args, ctxWith([]));
  assert.match(out.error, /maxPrice must be higher/);
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
      { role: 'user', content: 'what is 2+2?' },
    ],
    ctx: ctxWith([]),
  });
  assert.equal(seen, 'what is 2+2?');
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
        insert: async (row) => { rows.push({ id: rows.length + 1, ...row }); return { error: null }; },
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

test('advisor selectAtRisk picks open, near-deadline, below-threshold events', () => {
  const now = Date.now();
  const h = (n) => new Date(now + n * 3600 * 1000).toISOString();
  const rows = [
    { id: 'r1', derived_status: 'early_bird', deadlineAt: h(24), active_ticket_count: 2, hypeThreshold: 10 },
    { id: 'r2', derived_status: 'early_bird', deadlineAt: h(240), active_ticket_count: 2, hypeThreshold: 10 }, // too far out
    { id: 'r3', derived_status: 'greenlit', deadlineAt: h(24), active_ticket_count: 2, hypeThreshold: 10 }, // already greenlit
    { id: 'r4', derived_status: 'early_bird', deadlineAt: h(24), active_ticket_count: 12, hypeThreshold: 10 }, // already at threshold
  ];
  const picked = selectAtRisk(rows, now).map((e) => e.id);
  assert.deepEqual(picked, ['r1']);
});

