import { initialEvents } from '../data/mockEvents.js';
import { initialPledges } from '../data/mockPledges.js';

const clone = (value) => structuredClone(value);

const events = clone(initialEvents);
let pledges = clone(initialPledges);

function findEventIndex(eventId) {
  return events.findIndex((event) => event.id === eventId);
}

function getActiveTierIndex(event) {
  const idx = event.tiers.findIndex((tier) => tier.sold < tier.qty);
  if (idx === -1) return Math.max(0, event.tiers.length - 1);
  return Math.min(idx, event.tiers.length - 1);
}

function recalculateEvent(event) {
  event.hypePct = Math.min(100, Math.round((event.backers / event.threshold) * 100));
  event.spotsLeft = Math.max(0, event.capacity - event.backers);
  // The event greenlights once its Early Bird tickets (= threshold) are filled; from then on
  // the active tier (and price) is Main Crowd. Status only ever flips up to greenlit.
  if (event.status !== 'cancelled' && event.backers >= event.threshold) {
    event.status = 'greenlit';
  }
  event.price = event.tiers[getActiveTierIndex(event)].price;
}

// Allocate `qty` tickets across tiers from the active tier, spilling into the next
// tier when one runs out. Non-mutating; returns the per-tier lines and the total cost.
function tierAllocation(event, qty) {
  let remaining = Math.max(1, Number(qty) || 1);
  const lines = [];
  let total = 0;
  for (let i = getActiveTierIndex(event); i < event.tiers.length && remaining > 0; i += 1) {
    const tier = event.tiers[i];
    const available = Math.max(0, tier.qty - tier.sold);
    const count = Math.min(available, remaining);
    if (count > 0) {
      lines.push({ label: tier.label, price: tier.price, count });
      total += tier.price * count;
      remaining -= count;
    }
  }
  return { lines, total };
}

function applyPledgeToEvent(event, qty) {
  let remaining = qty;
  for (let i = getActiveTierIndex(event); i < event.tiers.length && remaining > 0; i += 1) {
    const tier = event.tiers[i];
    const available = Math.max(0, tier.qty - tier.sold);
    const soldNow = Math.min(available, remaining);
    tier.sold += soldNow;
    remaining -= soldNow;
  }
  event.backers += qty;
  recalculateEvent(event);
}

function reversePledgeFromEvent(event, qty) {
  let remaining = qty;
  for (let i = event.tiers.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const tier = event.tiers[i];
    const removed = Math.min(tier.sold, remaining);
    tier.sold -= removed;
    remaining -= removed;
  }
  event.backers = Math.max(0, event.backers - qty);
  recalculateEvent(event);
}

function publicTicket(ticket) {
  return {
    eventId: ticket.eventId,
    qty: ticket.qty,
    amount: ticket.amount,
    tab: ticket.tab,
    ticketStatus: ticket.ticketStatus,
    total: ticket.total != null ? ticket.total : ticket.amount * ticket.qty,
  };
}

// Quote `qty` tickets for an event: the per-tier breakdown and the total cost,
// spilling across tiers as each runs out. No service fee. All money math lives here.
export function quotePledge(eventId, qty) {
  const event = events.find((item) => item.id === eventId);
  if (!event) return null;

  const normalizedQty = Math.max(1, Number(qty) || 1);
  const { lines, total } = tierAllocation(event, normalizedQty);
  return {
    eventId,
    qty: normalizedQty,
    lines,
    subtotal: total,
    total,
  };
}

export function listEvents() {
  return clone(events);
}

export function getEvent(eventId) {
  const event = events.find((item) => item.id === eventId);
  return event ? clone(event) : null;
}

export function createPledge({ userId, eventId, qty, amount }) {
  const eventIndex = findEventIndex(eventId);
  if (eventIndex === -1) return null;

  const event = events[eventIndex];
  const normalizedQty = Math.max(1, Number(qty) || 1);
  const normalizedAmount = Number(amount) || event.price;

  const existingActive = pledges.find((pledge) => pledge.userId === userId && pledge.eventId === eventId && pledge.active);
  if (!existingActive) {
    // Compute the true multi-tier total before applying the pledge mutates `sold`.
    const { total } = tierAllocation(event, normalizedQty);
    applyPledgeToEvent(event, normalizedQty);
    pledges = pledges.filter((pledge) => !(pledge.userId === userId && pledge.eventId === eventId && !pledge.active));
    pledges.unshift({
      id: `p${Date.now()}`,
      userId,
      eventId,
      qty: normalizedQty,
      amount: normalizedAmount,
      total,
      tab: 'upcoming',
      ticketStatus: 'Pledged',
      active: true,
    });
  }

  return {
    event: clone(event),
    profile: getProfile(userId),
  };
}

export function cancelPledge({ userId, eventId, qty, amount }) {
  const eventIndex = findEventIndex(eventId);
  if (eventIndex === -1) return null;

  const event = events[eventIndex];
  const existingActive = pledges.find((pledge) => pledge.userId === userId && pledge.eventId === eventId && pledge.active);
  const normalizedQty = Math.max(1, Number(qty) || existingActive?.qty || 1);
  const normalizedAmount = Number(amount) || existingActive?.amount || event.price;
  const total = existingActive?.total != null ? existingActive.total : normalizedAmount * normalizedQty;

  if (existingActive) {
    reversePledgeFromEvent(event, normalizedQty);
  }

  pledges = pledges.filter((pledge) => !(pledge.userId === userId && pledge.eventId === eventId));
  pledges.unshift({
    id: `p${Date.now()}`,
    userId,
    eventId,
    qty: normalizedQty,
    amount: normalizedAmount,
    total,
    tab: 'cancelled',
    // Opting out is non-refundable. Refunds only happen when an event fails to
    // reach its threshold by the deadline (represented elsewhere as 'Refunded').
    ticketStatus: 'Cancelled',
    active: false,
  });

  return {
    event: clone(event),
    profile: getProfile(userId),
  };
}

export function getProfile(userId) {
  const tickets = pledges.filter((pledge) => pledge.userId === userId).map(publicTicket);
  const myEventIds = tickets
    .filter((ticket) => ticket.tab !== 'cancelled')
    .map((ticket) => ticket.eventId);

  return {
    profile: {
      id: userId,
      fullName: 'Jamie Tan',
      email: 'jamie@u.nus.edu',
      handle: '@jamiet',
    },
    tickets,
    myEventIds,
  };
}
