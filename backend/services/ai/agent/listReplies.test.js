import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { matchListQuery, buildListReply, matchBuyIntent, buildBuyIntentReply, matchLinkCardIntent, buildLinkCardReply } from './listReplies.js';
import { EXECUTORS } from './tools.js';

// buildListReply calls the real EXECUTORS; stub the three it uses and restore after.
const saved = {};
function stub(name, fn) {
  if (!(name in saved)) saved[name] = EXECUTORS[name];
  EXECUTORS[name] = fn;
}
afterEach(() => {
  for (const [name, fn] of Object.entries(saved)) EXECUTORS[name] = fn;
  for (const k of Object.keys(saved)) delete saved[k];
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

test('buildListReply falls through to null on executor error', async () => {
  stub('list_available_events', async () => { throw new Error('boom'); });
  assert.equal(await buildListReply('joinable', {}), null);
});
