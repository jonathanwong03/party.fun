import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { matchListQuery, buildListReply, matchBuyIntent, buildBuyIntentReply, matchLinkCardIntent, buildLinkCardReply } from './listReplies.js';
import { EXECUTORS, resolveVisibleRef, whyNotAttendable } from './tools.js';
import { __setEmbedForTests, __resetEmbedForTests } from '../embeddingService.js';

// buildListReply calls the real EXECUTORS; stub the three it uses and restore after.
const saved = {};
function stub(name, fn) {
  if (!(name in saved)) saved[name] = EXECUTORS[name];
  EXECUTORS[name] = fn;
}
afterEach(() => {
  for (const [name, fn] of Object.entries(saved)) EXECUTORS[name] = fn;
  for (const k of Object.keys(saved)) delete saved[k];
  __resetEmbedForTests();
  delete process.env.GEMINI_API_KEY; // embeddings stay OFF unless a test opts in
});

// ctx for the buy-intent path: get_profile carries the caller's tickets, every other rpc
// returns the event pool (get_events, via listEventsRaw). No REDIS_URL in tests → the SWR
// cache is a pass-through, so each call re-reads the stub.
const iso = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString();
const buyCtx = (events, { role = 'user', userId = 'u1', tickets = [], user = { walletBalance: 500, cardLast4: '4242', cardBrand: 'visa', stripePaymentMethodId: 'pm_1' } } = {}) => ({
  userId,
  role,
  supabase: {
    rpc: async (name) => {
      if (name === 'get_profile') return { data: { tickets }, error: null };
      return { data: events, error: null };
    },
    // propose_pledge reads the caller's wallet/card straight from the table.
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: user, error: null }) }) }) }),
  },
});
const gymEvent = (over = {}) => ({
  id: 'e1', title: 'Gymming for newbies', status: 'early_bird', hostId: 'other',
  startDate: iso(14), statuses: [{ price: 12 }], ...over,
});

// ── matchListQuery ────────────────────────────────────────────────────────────
test('classifies joinable (modal) vs joined (past tense)', () => {
  assert.equal(matchListQuery('what are the events that i can join?'), 'joinable');
  assert.equal(matchListQuery('what events can I attend'), 'joinable');
  assert.equal(matchListQuery('which events can i join'), 'joinable');
  assert.equal(matchListQuery('which events have I joined?'), 'joined');
  assert.equal(matchListQuery('what events have i joined'), 'joined');
  assert.equal(matchListQuery('my joined events'), 'joined');
  assert.equal(matchListQuery('events I have joined'), 'joined');
});

test('classifies live-events asks', () => {
  assert.equal(matchListQuery('what are the current live events hosted by all organisers?'), 'live');
  assert.equal(matchListQuery('show me live events'), 'live');
  assert.equal(matchListQuery('what events are currently live'), 'live');
});

test('classifies my-hosted/created asks (synonyms), not colliding with live', () => {
  assert.equal(matchListQuery('what events have I hosted?'), 'hosted');
  assert.equal(matchListQuery('what events have I created?'), 'hosted');
  assert.equal(matchListQuery('what events have I made'), 'hosted');
  assert.equal(matchListQuery('which events did I organise'), 'hosted');
  assert.equal(matchListQuery('my hosted events'), 'hosted');
  assert.equal(matchListQuery('my created events'), 'hosted');
  // Natural phrasings that previously fell through to the (truncating) LLM.
  assert.equal(matchListQuery('what are the events which i have hosted?'), 'hosted');
  assert.equal(matchListQuery('what are the events that i have created?'), 'hosted');
  // "hosted by all organisers" is the platform-wide live list, NOT my own events.
  assert.equal(matchListQuery('what are the live events hosted by all organisers?'), 'live');
});

// ── matchBuyIntent ─────────────────────────────────────────────────────────────
test('matchBuyIntent extracts the named event (and ignores unnamed buys)', () => {
  assert.equal(matchBuyIntent('i want to purchase tickets for game nigjt and esakn rooms'), 'game nigjt and esakn rooms');
  assert.equal(matchBuyIntent('help me buy 2 tickets for Neon Rave'), 'Neon Rave');
  assert.equal(matchBuyIntent('buy tickets for Gymming for newbies?'), 'Gymming for newbies');
  // No event named → the agent asks which one, as before.
  assert.equal(matchBuyIntent('i want to buy tickets'), null);
  assert.equal(matchBuyIntent('what events can I join'), null);
});

// ── link-card intent (card details must never enter the chat) ──────────────────
test('matchLinkCardIntent detects link requests and pasted card numbers', () => {
  assert.equal(matchLinkCardIntent('i want to link a card'), 'link_card');
  assert.equal(matchLinkCardIntent('add a credit card please'), 'link_card');
  assert.equal(matchLinkCardIntent('can you save my debit card'), 'link_card');
  // A pasted PAN must be caught so it is never echoed or stored.
  assert.equal(matchLinkCardIntent('4242424242424242'), 'card_number_pasted');
  assert.equal(matchLinkCardIntent('my card is 4242 4242 4242 4242'), 'card_number_pasted');
  // Unrelated asks fall through to the agent.
  assert.equal(matchLinkCardIntent('what events can I join'), null);
});

test('buildLinkCardReply never asks for a number and opens the form only on confirm', () => {
  const offer = buildLinkCardReply('link_card', false);
  assert.match(offer.reply, /secure card form/i);
  assert.equal(offer.action, undefined); // not opened until confirmed
  const confirmed = buildLinkCardReply('link_card', true);
  assert.equal(confirmed.action, 'open_card_form');
  // A pasted number is refused, not echoed.
  const pasted = buildLinkCardReply('card_number_pasted', false);
  assert.match(pasted.reply, /don't share card numbers/i);
  assert.doesNotMatch(pasted.reply, /\d{13,}/);
});

test('matchBuyIntent ignores QUESTIONS about buying (they fall through to the graph)', () => {
  // The reported bug: the greedy capture read the whole trailing clause as the event name,
  // so this asked to buy an event called "gymming for newbies after 1 august".
  assert.equal(matchBuyIntent('can i buy tickets for gymming for newbies after 1 august?'), null);
  assert.equal(matchBuyIntent('can i still buy tickets for Neon Rave?'), null);
  assert.equal(matchBuyIntent('is it too late to buy tickets for Neon Rave'), null);
  assert.equal(matchBuyIntent('when can i buy tickets for Neon Rave'), null);
  // …but a purchase politely phrased as a question is still a purchase.
  assert.equal(matchBuyIntent('can you help me buy 2 tickets for Neon Rave?'), 'Neon Rave');
});

test('matchBuyIntent prefers a quoted name over a trailing date clause', () => {
  assert.equal(matchBuyIntent('buy tickets for "gymming for newbies" after 1 august'), 'gymming for newbies');
  assert.equal(matchBuyIntent('buy tickets for “Neon Rave” tomorrow'), 'Neon Rave');
});

test('buildBuyIntentReply strips a trailing date clause only as a FALLBACK', async () => {
  // Candidate 1 ("… after 1 august") misses, candidate 2 resolves exactly → null, i.e. the
  // agent carries on with the normal payment-method → quantity flow.
  const ctx = buyCtx([gymEvent()]);
  assert.equal(await buildBuyIntentReply('gymming for newbies after 1 august', ctx), null);
  // Over-strip guard: an event legitimately titled with a date word resolves on candidate 1,
  // so the strip never runs and can't damage it.
  const friday = buyCtx([gymEvent({ title: 'Party on Friday' })]);
  assert.equal(await buildBuyIntentReply('Party on Friday', friday), null);
});

test('buildBuyIntentReply gives the TRUE reason instead of a false "cannot find"', async () => {
  // Already holds tickets → the event is excluded from the attendable pool, which used to
  // produce "I cannot find an event named X" about an event that plainly exists.
  const bought = buyCtx([gymEvent()], { tickets: [{ eventId: 'e1', tab: 'upcoming' }] });
  const reply = await buildBuyIntentReply('gymming for newbies', bought);
  assert.match(reply, /already have tickets/i);
  assert.doesNotMatch(reply, /cannot find/i);

  const own = buyCtx([gymEvent({ hostId: 'u1' })]);
  assert.match(await buildBuyIntentReply('gymming for newbies', own), /your own event/i);

  const cancelled = buyCtx([gymEvent({ status: 'cancelled' })]);
  assert.match(await buildBuyIntentReply('gymming for newbies', cancelled), /cancelled/i);

  const ended = buyCtx([gymEvent({ startDate: iso(-9), endDate: iso(-8) })]);
  assert.match(await buildBuyIntentReply('gymming for newbies', ended), /already ended/i);
});

// ── Full-capacity events are not buyable ──────────────────────────────────────
test('a FULL event is excluded from what you can join, and says so when named', async () => {
  const full = gymEvent({ maxCapacity: 6, active_ticket_count: 6 });
  const ctx = buyCtx([full]);
  // (b) "what can I join?" must not list an event with no spots left.
  const { events } = await EXECUTORS.list_available_events({}, ctx);
  assert.deepEqual(events.map((e) => e.title), []);
  // (a) naming it gets the real reason — not "cannot find", not "you already have tickets".
  const reply = await buildBuyIntentReply('gymming for newbies', ctx);
  assert.match(reply, /full capacity/i);
  assert.doesNotMatch(reply, /cannot find|already have tickets/i);
  // …and the buy tool refuses instead of building a proposal that dies at execute time.
  const proposed = await EXECUTORS.propose_pledge({ eventId: 'gymming for newbies', qty: 8 }, ctx);
  assert.equal(proposed.proposal, undefined);
  assert.match(proposed.error, /full capacity/i);
  assert.equal(await whyNotAttendable(full, ctx), 'sold_out');
});

test('propose_pledge refuses MORE tickets than remain, at proposal time', async () => {
  // The reported flow: 3 spots left, "8 tickets" produced a $88.00 proposal that only failed
  // on confirm with "Not enough tickets are available."
  const ctx = buyCtx([gymEvent({ maxCapacity: 6, active_ticket_count: 3 })]);
  const proposed = await EXECUTORS.propose_pledge({ eventId: 'gymming for newbies', qty: 8 }, ctx);
  assert.equal(proposed.proposal, undefined);
  assert.match(proposed.error, /Only 3 tickets are left/i);
  // A quantity that fits is still proposed as normal.
  const ok = await EXECUTORS.propose_pledge({ eventId: 'gymming for newbies', qty: 3, paymentMethod: 'wallet' }, ctx);
  assert.ok(ok.proposal || ok.error, 'a fitting quantity is not blocked by capacity');
  if (ok.error) assert.doesNotMatch(ok.error, /left for|full capacity/i);
});

test('an UNCAPPED event (maxCapacity 0) is never treated as sold out', async () => {
  // The trap: spotsLeft is 0 for an uncapped event, so gating on spotsLeft===0 instead of
  // soldOut semantics would silently hide every such event.
  const ctx = buyCtx([gymEvent({ maxCapacity: 0, active_ticket_count: 0 })]);
  const { events } = await EXECUTORS.list_available_events({}, ctx);
  assert.deepEqual(events.map((e) => e.title), ['Gymming for newbies']);
  assert.equal(await whyNotAttendable(gymEvent({ maxCapacity: 0 }), ctx), null);
});

test('buildBuyIntentReply never prompts an admin to confirm a purchase', async () => {
  // attendableEvents returns [] for admins, so this path can only ever mislead them: an
  // admin can't buy at all. A TYPO is the case that proves the guard — an exact name is
  // already rescued by the visible-pool lookup, but a typo would otherwise reach the
  // "Did you mean …?" purchase confirmation. Both must defer to the graph's role rules.
  const ctx = buyCtx([gymEvent()], { role: 'admin' });
  assert.equal(await buildBuyIntentReply('gymming for newbis', ctx), null);
  assert.equal(await buildBuyIntentReply('gymming for newbies', ctx), null);
});

test('whyNotAttendable mirrors the attendableEvents filter', async () => {
  const ctx = buyCtx([], { tickets: [{ eventId: 'e9', tab: 'upcoming' }] });
  assert.equal(await whyNotAttendable(gymEvent(), ctx), null); // buyable
  assert.equal(await whyNotAttendable(gymEvent({ status: 'cancelled' }), ctx), 'cancelled');
  assert.equal(await whyNotAttendable(gymEvent({ status: 'completed' }), ctx), 'completed');
  assert.equal(await whyNotAttendable(gymEvent({ startDate: iso(-9), endDate: iso(-8) }), ctx), 'ended');
  assert.equal(await whyNotAttendable(gymEvent({ startDate: iso(-1), endDate: iso(1) }), ctx), 'started');
  assert.equal(await whyNotAttendable(gymEvent({ hostId: 'u1' }), ctx), 'own_event');
  assert.equal(await whyNotAttendable(gymEvent({ id: 'e9' }), ctx), 'already_purchased');
  assert.equal(await whyNotAttendable(gymEvent({ viewer_can_attend: false }), ctx), 'restricted_university');
});

test('list_available_events excludes a university-restricted event the viewer cannot join', async () => {
  const ctx = buyCtx([
    gymEvent(),
    gymEvent({ id: 'e2', title: 'SMU Supper', viewer_can_attend: false, restricted_university: 'SMU' }),
  ]);
  const { events } = await EXECUTORS.list_available_events({}, ctx);
  assert.deepEqual(events.map((e) => e.title), ['Gymming for newbies'], 'the SMU-only event is not offered to an ineligible viewer');
  // A named buy for the ineligible event explains the restriction rather than starting a purchase.
  const reply = await buildBuyIntentReply('SMU Supper', ctx);
  assert.match(reply, /limited to students|not eligible|can't join/i);
});

test('resolveEvent does not offer a DISTANT semantic match as a suggestion', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  __setEmbedForTests(async () => [0.1, 0.2, 0.3]);
  const events = [{ id: 'e1', title: 'Grad Ball: Black-Tie Gala', status: 'early_bird', hostId: 'other', startDate: iso(14), statuses: [{ price: 40 }] }];
  const withSim = (similarity) => ({
    userId: 'u1',
    role: 'user',
    supabase: {
      rpc: async (name) => {
        if (name === 'get_profile') return { data: { tickets: [] }, error: null };
        if (name === 'match_events') return { data: [{ eventId: 'e1', similarity }], error: null };
        return { data: events, error: null };
      },
    },
  });
  // Both cases use the SAME query — one that scores ~0.05 on Dice and shares no substring
  // with the title — so ONLY the semantic step can produce a suggestion and the assertions
  // isolate its floor. (A query like "grad ball black tie" would score 0.81 on Dice and pass
  // either way, proving nothing.) The reported nonsense: "gymming for newbies" suggested
  // "Grad Ball: Black-Tie Gala".
  const distant = await resolveVisibleRef(withSim(0.42), 'gymming for newbies');
  assert.equal(distant.event, null);
  assert.equal(distant.ambiguous, undefined);
  // A genuinely close embedding match is still offered.
  const close = await resolveVisibleRef(withSim(0.72), 'gymming for newbies');
  assert.deepEqual(close.ambiguous, ['Grad Ball: Black-Tie Gala']);
});

test('buildBuyIntentReply confirms a typo and passes an exact name through', async () => {
  const attendable = [{ id: 'e1', title: 'Game night and escape rooms', status: 'early_bird', hostId: 'other', startDate: '2026-07-31T19:00:00+08:00', statuses: [{ price: 20 }] }];
  const ctx = { userId: 'u1', role: 'user', supabase: { rpc: async () => ({ data: attendable, error: null }) } };
  // Typo → the exact wording asked for, naming the closest attendable event.
  const typo = await buildBuyIntentReply('game nigjt and esakn rooms', ctx);
  assert.match(typo, /^I'm sorry, I cannot find an event named "game nigjt and esakn rooms"\./);
  assert.match(typo, /Did you mean "Game night and escape rooms"\?/);
  // Exact name → null so the normal agent flow (method → quantity) continues.
  assert.equal(await buildBuyIntentReply('Game night and escape rooms', ctx), null);
});

// ── superlative / single-fact asks must reach the LLM ──────────────────────────
test('matchListQuery returns null for SUPERLATIVE asks (all four kinds)', () => {
  // The reported bug: this dumped every hosted event, unordered and with no dates.
  assert.equal(matchListQuery('which is the earliest event that i hosted, and when?'), null);
  assert.equal(matchListQuery('what is the latest event i hosted'), null);
  assert.equal(matchListQuery('which event that i hosted is the most recent'), null);
  // The same defect reached the other three kinds too.
  assert.equal(matchListQuery('what is the earliest event i can join'), null);
  assert.equal(matchListQuery('which live event is the earliest'), null);
  assert.equal(matchListQuery('which events have i joined earliest'), null);
});

test('matchListQuery returns null when ONE fact is asked for, not a list', () => {
  assert.equal(matchListQuery('where did i host this event'), null);
  assert.equal(matchListQuery('when are the events i hosted'), null);
  assert.equal(matchListQuery('how long are the events i hosted'), null);
});

test('the new guards do NOT swallow the plain list asks', () => {
  // An over-broad superlative/detail regex would silently kill the short-circuits, so pin
  // every phrasing the deterministic renderers must still own. "current"/"which"/"what" are
  // deliberately NOT guarded — they are how the good list asks are phrased.
  assert.equal(matchListQuery('what are the current live events hosted by all organisers?'), 'live');
  assert.equal(matchListQuery('what events are currently live'), 'live');
  assert.equal(matchListQuery('which events can i join'), 'joinable');
  assert.equal(matchListQuery('what are the events that i can join?'), 'joinable');
  assert.equal(matchListQuery('which events have I joined?'), 'joined');
  assert.equal(matchListQuery('what events have I hosted?'), 'hosted');
  assert.equal(matchListQuery('my hosted events'), 'hosted');
});

test('past-tense "joined" never collides with the modal branch', () => {
  // Contains "joined" but is really the modal ask → must be joinable, not joined.
  assert.equal(matchListQuery('events i can join'), 'joinable');
});

test('returns null for qualified / specific-event / unrelated asks', () => {
  assert.equal(matchListQuery('what can I join under $20'), null);
  assert.equal(matchListQuery('events I can attend below $10'), null);
  assert.equal(matchListQuery('can I join "Neon Rave"?'), null);
  assert.equal(matchListQuery('tell me about the frisbee event'), null);
  assert.equal(matchListQuery(''), null);
  assert.equal(matchListQuery(undefined), null);
});

// ── buildListReply: joinable ───────────────────────────────────────────────────
test('joinable renders one numbered line per event', async () => {
  stub('list_available_events', async () => ({
    count: 2,
    events: [
      { title: 'Neon Rave', startDate: '2026-08-01T20:00:00+08:00', venue: 'Campus Green', currentPrice: 17.5 },
      { title: 'Sunset Picnic', startDate: '2026-08-05T18:00:00+08:00', venue: 'East Coast', currentPrice: 8 },
    ],
  }));
  const reply = await buildListReply('joinable', {});
  assert.match(reply, /You can join the following 2 events:/);
  assert.match(reply, /1\. "Neon Rave" on 2026-08-01 at Campus Green — \$17\.50\./);
  assert.match(reply, /2\. "Sunset Picnic" on 2026-08-05 at East Coast — \$8\.00\./);
  assert.doesNotMatch(reply, /3\./); // numbering stops at the real count
});

test('joinable empty state', async () => {
  stub('list_available_events', async () => ({ count: 0, events: [] }));
  assert.equal(await buildListReply('joinable', {}), 'There are no events available for you to join right now.');
});

// ── buildListReply: joined (grouped, each renumbered from 1) ────────────────────
test('joined groups upcoming/past/cancelled, each renumbered from 1, plain headers', async () => {
  stub('get_my_joined_events', async () => ({
    counts: { upcoming: 2, past: 1, cancelled: 1 },
    upcoming: [
      { title: 'Supper at Springleaf', startDate: '2026-07-24T22:00:00+08:00', venue: 'Springleaf', ticketsHeld: 5 },
      { title: 'Wine Wind-Down', startDate: '2026-07-14T19:00:00+08:00', venue: 'Tanjong Beach', ticketsHeld: 3 },
    ],
    past: [{ title: 'Neon Rave', startDate: '2026-06-26T20:00:00+08:00', venue: 'Campus Green', ticketsHeld: 10 }],
    cancelled: [{ title: 'bad test', startDate: '2026-06-24T20:00:00+08:00', venue: 'g', ticketsHeld: 0 }],
  }));
  const reply = await buildListReply('joined', {});
  assert.match(reply, /Upcoming events:\n1\. "Supper at Springleaf" on 2026-07-24 at Springleaf\. You have 5 tickets/);
  assert.match(reply, /2\. "Wine Wind-Down" on 2026-07-14 at Tanjong Beach\. You have 3 tickets/);
  assert.match(reply, /Past events:\n1\. "Neon Rave" on 2026-06-26 at Campus Green\. You had 10 tickets/);
  assert.match(reply, /Cancelled events:\n1\. "bad test" on 2026-06-24 at g\./);
  // Headers are NOT numbered.
  assert.doesNotMatch(reply, /\d\.\s*(Upcoming|Past|Cancelled) events:/);
});

test('joined omits empty groups and handles all-empty', async () => {
  stub('get_my_joined_events', async () => ({
    counts: { upcoming: 1, past: 0, cancelled: 0 },
    upcoming: [{ title: 'Only One', startDate: '2026-09-01T19:00:00+08:00', venue: 'Hall', ticketsHeld: 1 }],
    past: [],
    cancelled: [],
  }));
  const reply = await buildListReply('joined', {});
  assert.match(reply, /Upcoming events:/);
  assert.match(reply, /You have 1 ticket for this event/); // singular
  assert.doesNotMatch(reply, /Past events:/);
  assert.doesNotMatch(reply, /Cancelled events:/);

  stub('get_my_joined_events', async () => ({ counts: { upcoming: 0, past: 0, cancelled: 0 }, upcoming: [], past: [], cancelled: [] }));
  assert.equal(await buildListReply('joined', {}), "You haven't joined any events yet.");
});

// ── buildListReply: live ────────────────────────────────────────────────────────
test('live renders every organiser event, numbered with status + price', async () => {
  stub('list_live_events', async () => ({
    count: 2,
    events: [
      { title: 'Neon Rave', organiser: 'Alice', status: 'greenlit', currentPrice: 17.5, startDate: '2026-08-01T20:00:00+08:00', venue: 'Campus Green' },
      { title: 'Book Fair', organiser: 'Bob', status: 'early_bird', currentPrice: 5, startDate: '2026-08-03T10:00:00+08:00', venue: 'Library' },
    ],
  }));
  const reply = await buildListReply('live', {});
  assert.match(reply, /2 live events hosted across all organisers:/);
  assert.match(reply, /1\. "Neon Rave" by Alice on 2026-08-01 at Campus Green — greenlit, \$17\.50\./);
  assert.match(reply, /2\. "Book Fair" by Bob on 2026-08-03 at Library — early bird, \$5\.00\./);
});

test('live empty state', async () => {
  stub('list_live_events', async () => ({ count: 0, events: [] }));
  assert.equal(await buildListReply('live', {}), 'There are no live events right now.');
});

// ── buildListReply: hosted (grouped by status, headers unnumbered) ──────────────
test('hosted groups by status with plain headers and per-group numbering', async () => {
  stub('get_my_hosted_events', async () => ({
    count: 4,
    events: [
      { title: 'Neon Rave', status: 'greenlit', currentPrice: 30, ticketsSold: 55, revenueSoFar: 1650 },
      { title: 'Book Fair', status: 'early_bird', currentPrice: 5, ticketsSold: 3, revenueSoFar: 15 },
      { title: 'Exam Study Break', status: 'completed', currentPrice: 17, ticketsSold: 12, revenueSoFar: 134 },
      { title: 'Sunrise Yoga', status: 'cancelled', currentPrice: 10, ticketsSold: 0, revenueSoFar: 0 },
    ],
  }));
  const reply = await buildListReply('hosted', {});
  assert.match(reply, /Live events:\n1\. "Neon Rave" — \$30\.00, 55 tickets sold, \$1650\.00 revenue\./);
  assert.match(reply, /2\. "Book Fair" —/);
  assert.match(reply, /Completed events:\n1\. "Exam Study Break" —/);
  assert.match(reply, /Cancelled events:\n1\. "Sunrise Yoga" —/);
  // Headers are never numbered.
  assert.doesNotMatch(reply, /\d\.\s*(Live|Completed|Cancelled) events:/);
});

test('hosted empty state', async () => {
  stub('get_my_hosted_events', async () => ({ count: 0, events: [] }));
  assert.equal(await buildListReply('hosted', {}), "You haven't created any events yet.");
});

test('hosted prints the date and venue when the row carries them', async () => {
  // hostedLine used to drop startDate even though the executor returned it — the reported
  // reply had no dates at all. Conditional, so the no-date test above still holds.
  stub('get_my_hosted_events', async () => ({
    count: 1,
    events: [{ title: 'Campus Connect Night', status: 'greenlit', currentPrice: 10, ticketsSold: 7, revenueSoFar: 70, startDate: '2026-08-02T19:00:00+08:00', venue: 'SMU Green' }],
  }));
  const reply = await buildListReply('hosted', {});
  assert.match(reply, /1\. "Campus Connect Night" on 2026-08-02 at SMU Green — \$10\.00, 7 tickets sold, \$70\.00 revenue\./);
});

// ── the tools must carry duration/location/description for EVERY event ─────────
test('hosted / joined / live executors all return dates, venue and description', async () => {
  const raw = [{
    id: 'e1', hostId: 'u1', title: 'Gymming for newbies', description: 'A beginner-friendly gym session.',
    derived_status: 'early_bird', startDate: iso(14), endDate: iso(14.1), deadlineAt: iso(10),
    location: 'SMU Gym', address: '81 Victoria St', maxCapacity: 20, active_ticket_count: 6,
    statuses: [{ statusName: 'early_bird', price: 11, ticketCapacity: 10 }],
  }];
  const ctx = {
    userId: 'u1',
    role: 'organiser',
    supabase: {
      rpc: async (name) => {
        if (name === 'get_profile') return { data: { tickets: [{ eventId: 'e1', tab: 'upcoming', activeTicketCount: 2 }] }, error: null };
        if (name === 'get_hosted_revenue') return { data: [], error: null };
        return { data: raw, error: null };
      },
    },
  };
  const expectRich = (row, label) => {
    for (const f of ['startDate', 'endDate', 'venue', 'address', 'description', 'deadline']) {
      assert.ok(row[f] != null, `${label} should carry ${f}`);
    }
    assert.equal(row.venue, 'SMU Gym', `${label}.venue`);
    assert.equal(row.description, 'A beginner-friendly gym session.', `${label}.description`);
    assert.ok(row.endDate > row.startDate, `${label} duration is derivable`);
  };

  const hosted = await EXECUTORS.get_my_hosted_events({}, ctx);
  expectRich(hosted.events[0], 'get_my_hosted_events');
  // Host-only economics must survive the richRow switch.
  for (const f of ['earlyPrice', 'revenueSoFar', 'ticketsSold', 'hypeThreshold', 'maxCapacity']) {
    assert.ok(f in hosted.events[0], `get_my_hosted_events should keep ${f}`);
  }

  const joined = await EXECUTORS.get_my_joined_events({}, ctx);
  expectRich(joined.upcoming[0], 'get_my_joined_events');
  assert.equal(joined.upcoming[0].eventId, 'e1'); // id stays named eventId, and only once
  assert.equal(joined.upcoming[0].id, undefined);
  assert.equal(joined.upcoming[0].ticketsHeld, 2);

  const live = await EXECUTORS.list_live_events({}, ctx);
  expectRich(live.events[0], 'list_live_events');
});

test('buildListReply falls through to null on executor error', async () => {
  stub('list_available_events', async () => { throw new Error('boom'); });
  assert.equal(await buildListReply('joinable', {}), null);
});
