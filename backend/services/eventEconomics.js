// Simple profit calculator for an event: profit = total revenue - total cost.
// Shared by the analytics calculator endpoints, the AI revenue-tips task, and the
// assistant's economics tool. No prediction — the organiser supplies ticket
// prices/quantities (respecting the hype or tiered model) and operational-cost line
// items, and we just add them up.

import { withCache } from './cache.js';

const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

const statusPrice = (ev, name) => (ev?.statuses ?? []).find((s) => s.statusName === name)?.price ?? 0;
const statusQty = (ev, name) => (ev?.statuses ?? []).find((s) => s.statusName === name)?.ticketCapacity ?? 0;

// Default cost categories an organiser can rename/re-price/remove or add to.
const DEFAULT_COSTS = ['Venue', 'Food & drinks', 'Marketing', 'Staffing'];

// Revenue for a hype (bonding-curve) event: the k-th ticket costs
// basePrice * (maxPrice/basePrice)^(k/capacity). Mirrors backend/utils/pricingCalculator.js
// but is defensive (never throws) so it's safe for a free-form what-if calculator.
export function hypeRevenue(basePrice, maxPrice, capacity, qty) {
  const base = Number(basePrice) || 0;
  const max = Number(maxPrice) || 0;
  const cap = Math.max(1, Math.trunc(Number(capacity) || 0));
  const n = Math.max(0, Math.trunc(Number(qty) || 0));
  if (base <= 0 || max <= 0 || n === 0) return 0;
  const ratio = max / base;
  let total = 0;
  for (let k = 0; k < n; k += 1) {
    total += base * ratio ** Math.min(k / cap, 1); // clamp exponent so price never exceeds max
  }
  return roundMoney(total);
}

// Prefill the calculator from the event's real pricing (a starting guide the organiser
// edits). Quantities default to the tier/event capacity (a full-house baseline).
export function defaultCalculatorState(ev = {}) {
  const tickets = ev.hypeDrivenPricing
    ? {
      model: 'hype',
      basePrice: Number(ev.basePrice) || 0,
      maxPrice: Number(ev.maxPrice) || 0,
      capacity: Math.max(0, Math.trunc(Number(ev.maxCapacity) || 0)),
      qty: Math.max(0, Math.trunc(Number(ev.maxCapacity) || 0)),
    }
    : {
      model: 'tiered',
      tiers: [
        { key: 'early_bird', label: 'Early bird', price: Number(statusPrice(ev, 'early_bird')) || 0, qty: Math.max(0, Math.trunc(Number(statusQty(ev, 'early_bird')) || 0)) },
        { key: 'greenlit', label: 'Greenlit', price: Number(statusPrice(ev, 'greenlit')) || 0, qty: Math.max(0, Math.trunc(Number(statusQty(ev, 'greenlit')) || 0)) },
      ],
    };
  return { tickets, costs: DEFAULT_COSTS.map((name) => ({ name, amount: 0 })) };
}

// Add up revenue, cost and profit for a calculator state.
export function computeEconomics(state = {}) {
  const tickets = state.tickets ?? {};
  let totalRevenue = 0;
  let ticketCount = 0;

  if (tickets.model === 'hype') {
    ticketCount = Math.max(0, Math.trunc(Number(tickets.qty) || 0));
    totalRevenue = hypeRevenue(tickets.basePrice, tickets.maxPrice, tickets.capacity, ticketCount);
  } else {
    for (const tier of tickets.tiers ?? []) {
      const price = Number(tier.price) || 0;
      const qty = Math.max(0, Math.trunc(Number(tier.qty) || 0));
      totalRevenue += price * qty;
      ticketCount += qty;
    }
  }

  const costs = Array.isArray(state.costs) ? state.costs : [];
  const totalCost = costs.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const revenue = roundMoney(totalRevenue);
  const cost = roundMoney(totalCost);
  return {
    totalRevenue: revenue,
    totalCost: cost,
    profit: roundMoney(revenue - cost),
    ticketCount,
    avgTicketPrice: ticketCount > 0 ? roundMoney(revenue / ticketCount) : 0,
  };
}

// The saved calculator state for an event, or the prefilled defaults when none exists.
// Host-only (RLS). Cached per user+event when userId is passed (avoids serving one
// organiser's saved calculator to another); live when omitted.
export async function loadCalculator(supabase, ev, userId = null) {
  const load = async () => {
    try {
      const { data } = await supabase
        .from('EVENT_CALCULATOR')
        .select('state')
        .eq('eventId', ev.id)
        .maybeSingle();
      if (data?.state && typeof data.state === 'object' && Object.keys(data.state).length) {
        return data.state;
      }
    } catch { /* fall through to defaults */ }
    return defaultCalculatorState(ev);
  };
  return userId ? withCache(`data:calculator:u:${userId}:e:${ev.id}`, 60, load) : load();
}
