import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { __setProvidersForTests, __resetProvidersForTests, listConfiguredModels } from '../modelRouter.js';
import { runGraph, resumeGraph, classifyIntent, BRANCH_TOOLS, __setBuildModelForTests, __setAgentsForTests, __setClassifyForTests, __resetGraphForTests } from './eventGraph.js';
import { EXECUTORS, AGENT_TOOLS, TOOLS_BY_NAME } from './tools.js';
import { executeAction } from './actions.js';
import { selectAtRisk } from './advisor.js';

afterEach(() => { __resetProvidersForTests(); __resetGraphForTests(); });

// A fake branch agent: appends a fixed set of NEW messages onto the input list,
// mimicking what createAgent returns from `.invoke({ messages })`.
const fakeAgent = (newMessages) => ({ invoke: async ({ messages }) => ({ messages: [...messages, ...newMessages] }) });
const allBranches = (agent) => ({ read_only: agent, discovery: agent, best_fit: agent, event_mgmt: agent, transaction: agent });
const useAgents = (agent) => __setAgentsForTests(() => allBranches(agent));
const useModel = () => __setBuildModelForTests(async () => ({ model: {}, provider: 'anthropic', modelId: 'mock' }));
const useClassify = (intent) => __setClassifyForTests(async () => intent);

// Message helpers.
const say = (text) => new AIMessage(text);
const toolMsg = (obj, name = 'tool', id = 't1') => new ToolMessage({ content: JSON.stringify(obj), tool_call_id: id, name });

// An unconfigured provider stub (for the modelRouter listConfiguredModels test).
const unconfigured = () => ({ isConfigured: () => false, chatWithTools: async () => ({}) });

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
  assert.equal(out.provider, 'anthropic');
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

test('list_available_events excludes own + purchased events', async () => {
  const events = [
    { id: 'e1', title: 'Buyable', status: 'early_bird', hostId: 'other', statuses: [{ price: 10 }] },
    { id: 'e2', title: 'Mine', status: 'early_bird', hostId: 'u1', statuses: [{ price: 5 }] },
    { id: 'e3', title: 'Already bought', status: 'early_bird', hostId: 'other', statuses: [{ price: 8 }] },
  ];
  const ctx = {
    userId: 'u1',
    role: 'user',
    supabase: {
      rpc: async () => ({ data: events, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ is: async () => ({ data: [{ eventId: 'e3' }], error: null }) }) }) }),
    },
  };
  const out = await EXECUTORS.list_available_events({}, ctx);
  assert.deepEqual(out.events.map((e) => e.id), ['e1']);
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

test('propose_pledge proposes a wallet purchase, blocks own event', async () => {
  const events = [
    { id: 'e1', title: 'Gala', status: 'early_bird', hostId: 'other', statuses: [{ price: 10 }] },
    { id: 'e2', title: 'Mine', status: 'early_bird', hostId: 'u1', statuses: [{ price: 5 }] },
  ];
  const ok = await EXECUTORS.propose_pledge({ eventId: 'e1', qty: 2 }, ctxWith(events));
  assert.equal(ok.proposal.action, 'pledge');
  assert.equal(ok.proposal.payload.qty, 2);
  assert.match(ok.proposal.summary, /\$20\.00/);
  const own = await EXECUTORS.propose_pledge({ eventId: 'e2' }, ctxWith(events));
  assert.ok(own.error);
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

test('get_wallet returns balance, card and recent transactions', async () => {
  const out = await EXECUTORS.get_wallet({}, ctxFull({ user: { walletBalance: 42, cardBrand: 'visa', cardLast4: '4242' } }));
  assert.equal(out.balance, 42);
  assert.deepEqual(out.card, { brand: 'visa', last4: '4242' });
  assert.ok(Array.isArray(out.recentTransactions));
});

test('AGENT_TOOLS exposes all 16 tools as tool()+zod objects, invokable end-to-end', async () => {
  assert.equal(AGENT_TOOLS.length, 16);
  const names = AGENT_TOOLS.map((t) => t.name).sort();
  assert.ok(names.includes('search_events') && names.includes('propose_topup') && names.includes('get_wallet'));
  // Every entry is a StructuredTool with a zod schema.
  assert.ok(AGENT_TOOLS.every((t) => typeof t.invoke === 'function' && t.schema));

  // Invoke a tool through the LangChain wrapper: ctx flows via config.configurable and
  // the result is the JSON-stringified executor output.
  const ctx = ctxFull({ user: { walletBalance: 42, cardBrand: 'visa', cardLast4: '4242' } });
  const raw = await TOOLS_BY_NAME.get_wallet.invoke({}, { configurable: { ctx } });
  assert.equal(JSON.parse(raw).balance, 42);
});

// ── New executeAction branches (deterministic, re-validated) ─────────────────
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
