import { initialUsers } from '../data/mockUsers.js';
import { initialEvents } from '../data/mockEvents.js';
import { initialEventSettings } from '../data/mockEventSettings.js';
import { initialPriceTiers } from '../data/mockPriceTiers.js';
import { initialBookings } from '../data/mockBookings.js';
import { initialBookingItems } from '../data/mockBookingItems.js';
import { initialTickets } from '../data/mockTickets.js';

const clone = (value) => structuredClone(value);
const users = clone(initialUsers);
const events = clone(initialEvents);
const eventSettings = clone(initialEventSettings);
const priceTiers = clone(initialPriceTiers);
let bookings = clone(initialBookings);
let bookingItems = clone(initialBookingItems);
let tickets = clone(initialTickets);

const ACTIVE_TICKET_STATUSES = new Set(['active', 'used']);
const TIER_ORDER = ['early_bird', 'main_crowd'];
const TIER_LABELS = { early_bird: 'Early Birds', main_crowd: 'Main Crowd' };

const money = (value) => Number(Number(value).toFixed(2));
const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isDeleted = (bookingId) => !!bookings.find((booking) => booking.id === bookingId)?.deletedAt;
const activeTickets = (bookingId) => tickets.filter((ticket) => ticket.bookingId === bookingId && ACTIVE_TICKET_STATUSES.has(ticket.status));
const eventBookings = (eventId) => bookings.filter((booking) => booking.eventId === eventId);
const eventTickets = (eventId) => {
  // Tickets of soft-deleted bookings are excluded so a deleted booking never counts toward hype/spots.
  const bookingIds = new Set(eventBookings(eventId).filter((booking) => !booking.deletedAt).map((booking) => booking.id));
  return tickets.filter((ticket) => bookingIds.has(ticket.bookingId));
};
const activeEventTickets = (eventId) => eventTickets(eventId).filter((ticket) => ACTIVE_TICKET_STATUSES.has(ticket.status));

function getSettings(eventId) {
  return eventSettings.find((settings) => settings.eventId === eventId);
}

function getTiers(eventId) {
  return priceTiers
    .filter((tier) => tier.eventId === eventId)
    .sort((a, b) => TIER_ORDER.indexOf(a.tierName) - TIER_ORDER.indexOf(b.tierName));
}

function ticketTier(ticket) {
  const item = bookingItems.find((candidate) => candidate.id === ticket.bookingItemId);
  return priceTiers.find((tier) => tier.id === item?.priceTierId);
}

function tierActiveCount(tierId) {
  const itemIds = new Set(bookingItems.filter((item) => item.priceTierId === tierId).map((item) => item.id));
  return tickets.filter((ticket) => itemIds.has(ticket.bookingItemId) && ACTIVE_TICKET_STATUSES.has(ticket.status) && !isDeleted(ticket.bookingId)).length;
}

function recalculateEvent(event) {
  const settings = getSettings(event.id);
  const count = activeEventTickets(event.id).length;
  const early = getTiers(event.id).find((tier) => tier.tierName === 'early_bird');
  if (event.currentTierName === 'early_bird' && early && tierActiveCount(early.id) >= early.ticketCapacity) {
    event.currentTierName = 'main_crowd';
  }
  if (event.status !== 'cancelled' && event.status !== 'completed') {
    event.status = count >= settings.hypeThreshold ? 'greenlit' : 'pending';
    if (event.status === 'greenlit' && !event.greenlitAt) event.greenlitAt = new Date().toISOString();
  }
  event.updatedAt = new Date().toISOString();
}

function formatDate(value, options) {
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', ...options }).format(new Date(value));
}

function publicEvent(event, userId) {
  recalculateEvent(event);
  const settings = getSettings(event.id);
  const tiers = getTiers(event.id);
  const activeTicketCount = activeEventTickets(event.id).length;
  const currentTier = tiers.find((tier) => tier.tierName === event.currentTierName) ?? tiers[0];
  return {
    id: event.id,
    hostId: event.hostId,
    title: event.title,
    organiser: users.find((user) => user.id === event.hostId)?.name ?? 'Unknown organiser',
    date: formatDate(event.startDate, { weekday: 'short', month: 'short', day: 'numeric' }),
    time: formatDate(event.startDate, { hour: 'numeric', minute: '2-digit', hour12: true }),
    endTime: formatDate(event.endDate, { hour: 'numeric', minute: '2-digit', hour12: true }),
    endDate: formatDate(event.endDate, { weekday: 'short', month: 'short', day: 'numeric' }),
    startsAt: event.startDate,
    endsAt: event.endDate,
    deadlineAt: settings.deadline,
    location: event.location,
    description: event.description,
    image: event.imageUrl,
    price: currentTier?.price ?? 0,
    tierLabel: TIER_LABELS[event.currentTierName],
    currentTierName: event.currentTierName,
    hypePercentage: Math.min(100, Math.round((activeTicketCount / settings.hypeThreshold) * 100)),
    hypeThreshold: settings.hypeThreshold,
    activeTicketCount,
    maxCapacity: settings.maxCapacity,
    spotsLeft: Math.max(0, settings.maxCapacity - activeTicketCount),
    status: event.status,
    deadline: formatDate(settings.deadline, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
    tiers: tiers.map((tier) => ({
      tierName: tier.tierName,
      label: TIER_LABELS[tier.tierName],
      price: tier.price,
      qty: tier.ticketCapacity,
      sold: tierActiveCount(tier.id),
    })),
    mine: userId ? event.hostId === userId : undefined,
  };
}

function allocation(event, quantity) {
  const settings = getSettings(event.id);
  const available = settings.maxCapacity - activeEventTickets(event.id).length;
  let remaining = Math.min(Math.max(1, Number(quantity) || 1), Math.max(0, available));
  const lines = [];
  const tiers = getTiers(event.id);
  const start = TIER_ORDER.indexOf(event.currentTierName);

  for (let index = start; index < tiers.length && remaining > 0; index += 1) {
    const tier = tiers[index];
    const tierAvailable = tier.tierName === 'main_crowd' && event.currentTierName === 'main_crowd'
      ? available
      : Math.max(0, tier.ticketCapacity - tierActiveCount(tier.id));
    const count = Math.min(tierAvailable, remaining);
    if (count > 0) {
      lines.push({ tierId: tier.id, tierName: tier.tierName, label: TIER_LABELS[tier.tierName], price: tier.price, count });
      remaining -= count;
    }
  }
  return { lines, unallocated: remaining };
}

export function quotePledge(eventId, quantity) {
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) return null;
  const requested = Math.max(1, Number(quantity) || 1);
  const { lines, unallocated } = allocation(event, requested);
  if (unallocated > 0) return { error: 'not_enough_tickets' };
  const total = money(lines.reduce((sum, line) => sum + line.price * line.count, 0));
  return { eventId, qty: requested, lines: lines.map(({ label, price, count }) => ({ label, price, count })), subtotal: total, total };
}

export function listEvents(userId) {
  return events.map((event) => publicEvent(event, userId));
}

export function getEvent(eventId, userId) {
  const event = events.find((candidate) => candidate.id === eventId);
  return event ? publicEvent(event, userId) : null;
}

export function createPledge({ userId, eventId, qty }) {
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) return { error: 'not_found' };
  if (event.hostId === userId) return { error: 'own_event' };
  if (bookings.some((booking) => booking.userId === userId && booking.eventId === eventId && !booking.deletedAt && activeTickets(booking.id).length > 0)) {
    return { error: 'active_booking_exists' };
  }

  const requested = Math.max(1, Number(qty) || 1);
  const { lines, unallocated } = allocation(event, requested);
  if (unallocated > 0) return { error: 'not_enough_tickets' };

  const now = new Date().toISOString();
  const booking = {
    id: id('booking'),
    userId,
    eventId,
    amountPaid: money(lines.reduce((sum, line) => sum + line.price * line.count, 0)),
    refundedAmount: 0,
    status: 'captured',
    capturedAt: now,
    refundedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  bookings.push(booking);
  for (const line of lines) {
    const item = { id: id('item'), bookingId: booking.id, priceTierId: line.tierId, quantity: line.count, unitPrice: line.price, subtotal: money(line.price * line.count), createdAt: now };
    bookingItems.push(item);
    for (let index = 0; index < line.count; index += 1) {
      tickets.push({ id: id('ticket'), bookingId: booking.id, bookingItemId: item.id, qrCode: id('PF'), status: 'active', givenAwayAt: null, refundedAt: null, usedAt: null, createdAt: now });
    }
  }
  recalculateEvent(event);
  return { event: publicEvent(event, userId), profile: getProfile(userId) };
}

export function giveAwayTickets({ userId, bookingId, quantity }) {
  const booking = bookings.find((candidate) => candidate.id === bookingId && candidate.userId === userId);
  if (!booking) return { error: 'not_found' };
  const active = activeTickets(booking.id).sort((a, b) => (ticketTier(b)?.price ?? 0) - (ticketTier(a)?.price ?? 0));
  const normalized = Number(quantity);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > active.length) return { error: 'invalid_quantity' };

  const now = new Date().toISOString();
  active.slice(0, normalized).forEach((ticket) => {
    ticket.status = 'given_away';
    ticket.givenAwayAt = now;
  });
  booking.status = normalized === active.length ? 'given_away' : 'partially_given_away';
  booking.updatedAt = now;
  const event = events.find((candidate) => candidate.id === booking.eventId);
  recalculateEvent(event);
  return { event: publicEvent(event, userId), profile: getProfile(userId) };
}

export function deleteBooking({ userId, bookingId }) {
  const booking = bookings.find((candidate) => candidate.id === bookingId && candidate.userId === userId);
  if (!booking) return { error: 'not_found' };

  // Soft delete: keep the row (audit/recovery), just mark it deleted so it's hidden everywhere.
  const now = new Date().toISOString();
  booking.deletedAt = now;
  booking.updatedAt = now;

  const event = events.find((candidate) => candidate.id === booking.eventId);
  if (event) recalculateEvent(event);
  return { event: event ? publicEvent(event, userId) : null, profile: getProfile(userId) };
}

function publicBooking(booking) {
  const activeTicketCount = activeTickets(booking.id).length;
  const originalTicketCount = tickets.filter((ticket) => ticket.bookingId === booking.id).length;
  const event = events.find((candidate) => candidate.id === booking.eventId);
  const tab = event?.status === 'cancelled'
    ? 'cancelled'
    : activeTicketCount > 0
      ? (event?.status === 'completed' ? 'past' : 'upcoming')
      : 'cancelled';
  return {
    bookingId: booking.id,
    eventId: booking.eventId,
    activeTicketCount,
    originalTicketCount,
    bookingStatus: booking.status,
    tab,
  };
}

export function getProfile(userId) {
  const user = users.find((candidate) => candidate.id === userId);
  const profileBookings = bookings.filter((booking) => booking.userId === userId && !booking.deletedAt).map(publicBooking);
  return {
    profile: {
      id: userId,
      fullName: user?.name ?? 'Unknown user',
      email: user?.email ?? '',
      handle: user?.contact ?? `@${user?.username ?? 'user'}`,
    },
    tickets: profileBookings,
    myEventIds: profileBookings.filter((booking) => booking.activeTicketCount > 0).map((booking) => booking.eventId),
  };
}
