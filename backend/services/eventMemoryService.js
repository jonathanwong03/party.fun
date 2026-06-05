import { initialEvents } from '../data/mockEvents.js';
import { initialPledges } from '../data/mockPledges.js';
import { SERVICE_FEE } from '../data/mockPricing.js';
import { getUserById } from './userMemoryService.js';

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
  
  if (event.status === 'cancelled' || event.status === 'completed') {
    // Keep terminal statuses
    return;
  }
  
  if (event.backers >= event.threshold) {
    event.status = 'greenlit';
  } else if (event.hypePct >= 75) {
    event.status = 'almost';
  } else {
    event.status = 'live';
  }
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
  const subtotal = ticket.amount * ticket.qty;
  return {
    eventId: ticket.eventId,
    qty: ticket.qty,
    amount: ticket.amount,
    tab: ticket.tab,
    ticketStatus: ticket.ticketStatus,
    fee: SERVICE_FEE,
    total: subtotal + SERVICE_FEE,
  };
}

// Compute the cost of pledging `qty` tickets for an event: per-ticket price (the
// active tier), subtotal, the fixed service fee and the grand total. All money
// math for the app lives here on the backend.
export function quotePledge(eventId, qty) {
  const event = events.find((item) => item.id === eventId);
  if (!event) return null;

  const normalizedQty = Math.max(1, Number(qty) || 1);
  const pricePerTicket = event.price;
  const subtotal = pricePerTicket * normalizedQty;
  return {
    eventId,
    pricePerTicket,
    qty: normalizedQty,
    subtotal,
    fee: SERVICE_FEE,
    total: subtotal + SERVICE_FEE,
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
    applyPledgeToEvent(event, normalizedQty);
    pledges = pledges.filter((pledge) => !(pledge.userId === userId && pledge.eventId === eventId && !pledge.active));
    pledges.unshift({
      id: `p${Date.now()}`,
      userId,
      eventId,
      qty: normalizedQty,
      amount: normalizedAmount,
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
    tab: 'cancelled',
    ticketStatus: 'Refunded',
    active: false,
  });

  return {
    event: clone(event),
    profile: getProfile(userId),
    cancelledQty: normalizedQty,
    cancelledAmount: normalizedAmount,
  };
}

export function getProfile(userId) {
  const tickets = pledges.filter((pledge) => pledge.userId === userId).map(publicTicket);
  const myEventIds = tickets
    .filter((ticket) => ticket.tab !== 'cancelled')
    .map((ticket) => ticket.eventId);

  const user = getUserById(userId);

  return {
    profile: {
      id: userId,
      fullName: user ? user.username : 'Jamie Tan',
      email: user ? user.email : 'jamie@u.nus.edu',
      handle: user ? `@${user.username.toLowerCase()}` : '@jamiet',
    },
    tickets,
    myEventIds,
  };
}

export function getEventBackers(eventId) {
  return pledges
    .filter((p) => p.eventId === eventId && p.active)
    .map((p) => p.userId);
}

