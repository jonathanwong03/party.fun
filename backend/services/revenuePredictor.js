const WEIGHTS = {
  location: 0.22,
  timing: 0.18,
  day_of_week: 0.18,
  description: 0.16,
  pricing: 0.26,
};

const PRICE_ANCHOR = 60;
const DEFAULT_CENTRALITY = 0.5;
const TIMING_BY_HOUR = [
  0.20, 0.18, 0.18, 0.18, 0.20, 0.25,
  0.35, 0.40, 0.45, 0.50, 0.52, 0.55,
  0.55, 0.55, 0.55, 0.58, 0.65, 0.80,
  0.95, 1.00, 1.00, 0.95, 0.80, 0.55,
];
const DOW_SCORES = [0.45, 0.45, 0.50, 0.60, 1.00, 1.00, 0.70];
const DESCRIPTION_FULL_WORDS = 60;
const DESCRIPTION_KEYWORDS = new Set([
  'free', 'win', 'prize', 'prizes', 'exclusive', 'party', 'live', 'vip', 'limited',
  'night', 'celebrate', 'dj', 'food', 'drinks', 'networking', 'amazing', 'epic',
  'unforgettable', 'vibes', 'lineup', 'headliner', 'giveaway', 'rooftop', 'festival',
]);

function buildSectorScores() {
  const scores = {};
  const fill = (lo, hi, val) => {
    for (let s = lo; s <= hi; s += 1) scores[String(s).padStart(2, '0')] = val;
  };
  fill(1, 8, 0.90);
  fill(9, 10, 1.00);
  fill(11, 13, 0.80);
  fill(14, 16, 0.62);
  fill(17, 21, 0.52);
  fill(22, 24, 0.22);
  fill(25, 28, 0.32);
  fill(60, 64, 0.32);
  fill(65, 68, 0.28);
  fill(69, 73, 0.22);
  return scores;
}

const POSTAL_SECTOR_CENTRALITY = buildSectorScores();

export function clamp(x, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, Number(x) || 0));
}

export function scoreLocation(postalCode) {
  const digits = String(postalCode ?? '').replace(/\D/g, '');
  if (digits.length < 2) return DEFAULT_CENTRALITY;
  return POSTAL_SECTOR_CENTRALITY[digits.slice(0, 2)] ?? DEFAULT_CENTRALITY;
}

export function scoreTiming(startHour) {
  if (startHour == null) return 0.5;
  const hour = Number(startHour);
  return Number.isFinite(hour) ? TIMING_BY_HOUR[((Math.trunc(hour) % 24) + 24) % 24] : 0.5;
}

export function scoreDayOfWeek(dayOfWeek) {
  if (dayOfWeek == null) return 0.5;
  const dow = Number(dayOfWeek);
  return Number.isFinite(dow) ? DOW_SCORES[((Math.trunc(dow) % 7) + 7) % 7] : 0.5;
}

export function scoreDescription(description) {
  const text = String(description ?? '').trim();
  if (!text) return 0.3;
  const words = text.split(/\s+/);
  const lengthScore = clamp(words.length / DESCRIPTION_FULL_WORDS);
  const lowered = text.toLowerCase();
  let hits = 0;
  for (const keyword of DESCRIPTION_KEYWORDS) {
    if (lowered.includes(keyword)) hits += 1;
  }
  let excitement = clamp(hits / 3);
  if (text.includes('!')) excitement = clamp(excitement + 0.15);
  return clamp(0.6 * lengthScore + 0.4 * excitement);
}

export function scorePricing(avgPrice) {
  return clamp(1 - Number(avgPrice || 0) / PRICE_ANCHOR);
}

export function avgTicketPrice(features) {
  if (features.pricing_model === 'hype' && features.base_price != null && features.max_price != null) {
    return roundMoney((Number(features.base_price) + Number(features.max_price)) / 2);
  }
  const earlyCapacity = Number(features.early_capacity || 0);
  const greenlitCapacity = Number(features.greenlit_capacity || 0);
  const cap = earlyCapacity + greenlitCapacity;
  if (cap > 0) {
    return roundMoney(
      (Number(features.early_price || 0) * earlyCapacity
        + Number(features.greenlit_price || 0) * greenlitCapacity) / cap,
    );
  }
  return roundMoney(features.early_price || 0);
}

export function attractivenessBreakdown(features, avgPrice) {
  return {
    location: scoreLocation(features.postal_code),
    timing: scoreTiming(features.start_hour),
    day_of_week: scoreDayOfWeek(features.day_of_week),
    description: scoreDescription(features.description),
    pricing: scorePricing(avgPrice),
  };
}

export function attractivenessScore(breakdown) {
  return clamp(Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + weight * breakdown[key], 0));
}

export function projectedFinalTickets(features, attractiveness) {
  const capacity = Math.max(0, Math.trunc(Number(features.max_capacity || 0)));
  if (capacity === 0) return 0;
  const active = Math.max(0, Math.trunc(Number(features.active_tickets || 0)));
  if (active >= capacity) return capacity;
  const staticDemand = attractiveness * capacity;
  const elapsed = Math.max(0, Number(features.elapsed_hours || 0));
  const remaining = Math.max(0, Number(features.remaining_hours || 0));
  const velocity = elapsed > 0 ? active + (active / elapsed) * remaining : staticDemand;
  const totalTime = elapsed + remaining;
  const confidence = totalTime > 0 ? clamp(elapsed / totalTime) : 0;
  const blended = (1 - confidence) * staticDemand + confidence * velocity;
  return clamp(blended, active, capacity);
}

// Distribute the full projected ticket total across the days leading up to the
// event, weighted toward the event day. The bucket sum equals round(total) so
// the daily-sales graph reconciles exactly with the projected-tickets headline.
export function dailySales(total, daysUntilEvent) {
  const count = Math.max(0, Math.round(Number(total || 0)));
  const days = Math.max(1, Math.trunc(Number(daysUntilEvent || 0)));
  if (count <= 0) return Array.from({ length: days }, (_, i) => ({ dayOffset: i + 1, tickets: 0 }));

  const weights = Array.from({ length: days }, (_, i) => i + 1);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const out = weights.map((w) => Math.trunc((count * w) / totalWeight));
  let leftover = count - out.reduce((sum, n) => sum + n, 0);
  for (let i = days - 1; leftover > 0 && i >= 0; i -= 1) {
    out[i] += 1;
    leftover -= 1;
  }
  return out.map((tickets, i) => ({ dayOffset: i + 1, tickets }));
}

// Price of the cumulative (index)-th ticket (0-based) per the event's pricing model:
// hype tickets escalate from base toward max; tiered tickets are early-bird until the
// early allocation sells out, then greenlit.
export function ticketPriceAtIndex(features, index) {
  const i = Math.max(0, Math.trunc(Number(index || 0)));
  if (features.pricing_model === 'hype' && features.base_price != null) {
    const base = Number(features.base_price || 0);
    const max = Number(features.max_price ?? base);
    const cap = Math.max(1, Math.trunc(Number(features.max_capacity || 0)));
    return roundMoney(base + (max - base) * clamp(i / cap));
  }
  const earlyCap = Math.max(0, Math.trunc(Number(features.early_capacity || 0)));
  const earlyPrice = Number(features.early_price || 0);
  const greenlitPrice = Number(features.greenlit_price ?? earlyPrice);
  return roundMoney(earlyCap > 0 && i >= earlyCap ? greenlitPrice : earlyPrice);
}

// Revenue per day: price each projected ticket by its cumulative sale position so the
// curve reflects the pricing model. Daily sums add up to the projected revenue.
export function dailyRevenue(curve, features) {
  let index = 0;
  return curve.map((d) => {
    let revenue = 0;
    for (let k = 0; k < d.tickets; k += 1) {
      revenue += ticketPriceAtIndex(features, index);
      index += 1;
    }
    return { dayOffset: d.dayOffset, revenue: roundMoney(revenue) };
  });
}

// Estimated operational costs (SGD) the organiser pays outside party.fun, scaled
// to the event's projected attendees and revenue. Each entry is { category, cost }.
export function operationalCosts(features = {}, scale = {}) {
  const attendees = Math.max(0, Math.trunc(Number(scale.attendees || 0)));
  const revenue = Math.max(0, Number(scale.revenue || 0));
  const capacity = Math.max(0, Math.trunc(Number(features.max_capacity || 0)));
  const text = `${features.title ?? ''} ${features.description ?? ''}`.toLowerCase();

  const costs = new Map([
    ['Venue booking', Math.max(150, 4 * capacity)],
    ['Food and drinks', 8 * attendees],
    ['Event staffing', Math.max(120, 4 * attendees)],
    ['Security', Math.max(120, 2 * attendees)],
    ['Cleaning', 80 + 0.5 * attendees],
    ['Marketing and publicity', Math.max(50, 0.08 * revenue)],
    ['Ticketing and payment fees', 0.034 * revenue + 0.5 * attendees],
  ]);
  if (/\b(dj|music|band|rave|disco|party|concert|jam|open mic|dance)\b/.test(text)) {
    costs.set('DJ or live talent', 400);
    costs.set('Sound and lighting', 250);
    costs.set('Decor', 120);
  }
  if (/\b(workshop|clinic|networking|talk|speaker|briefing|seminar|hackathon)\b/.test(text)) {
    costs.set('Speakers or facilitators', 300);
    costs.set('Workshop materials', 6 * attendees);
    costs.set('AV setup', 200);
  }
  if (/\b(outdoor|picnic|sports|yoga|rooftop|field|beach|barrage|green)\b/.test(text)) {
    costs.set('Permits', 150);
    costs.set('Equipment rental', 200);
    costs.set('Weather contingency', 100);
  }
  return Array.from(costs, ([category, cost]) => ({ category, cost: roundMoney(cost) }));
}

export function predictRevenue(features) {
  const avgPrice = avgTicketPrice(features);
  const breakdown = attractivenessBreakdown(features, avgPrice);
  const attractiveness = attractivenessScore(breakdown);
  const projectedFinal = projectedFinalTickets(features, attractiveness);
  const curve = dailySales(projectedFinal, features.days_until_event);
  const projectedSold = curve.reduce((sum, d) => sum + d.tickets, 0);
  const revenueCurve = dailyRevenue(curve, features);
  const projectedRevenue = roundMoney(revenueCurve.reduce((sum, d) => sum + d.revenue, 0));
  const displayAvgPrice = projectedSold > 0 ? roundMoney(projectedRevenue / projectedSold) : avgPrice;

  const costs = operationalCosts(features, { attendees: projectedSold, revenue: projectedRevenue });
  const totalOperationalCost = roundMoney(costs.reduce((sum, c) => sum + c.cost, 0));
  const estimatedNet = roundMoney(projectedRevenue - totalOperationalCost);

  return {
    attractiveness: round3(attractiveness),
    projectedTicketsSold: projectedSold,
    avgTicketPrice: displayAvgPrice,
    projectedRevenue,
    dailySales: curve,
    dailyRevenue: revenueCurve,
    breakdown: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, round3(value)])),
    operationalCosts: costs,
    totalOperationalCost,
    estimatedNet,
  };
}

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}
