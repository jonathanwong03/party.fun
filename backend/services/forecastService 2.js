import { adminClient } from './supabaseAdmin.js';
import { predictRevenue } from './revenueForecaster.js';
import { embedText, toVectorLiteral, isEmbeddingEnabled } from './ai/embeddingService.js';

// Benchmark the event against the most SIMILAR past events' real sell-through
// (semantic match). Returns null when embeddings/data are unavailable. Never throws.
export async function similarPastBenchmark(admin, ev) {
  try {
    if (!isEmbeddingEnabled()) return null;
    const text = [ev.title, ev.description, ev.location, ev.address].filter(Boolean).join('\n');
    const vec = await embedText(text, { taskType: 'RETRIEVAL_QUERY' });
    if (!vec) return null;
    const { data } = await admin.rpc('match_similar_past_events', { p_embedding: toVectorLiteral(vec), p_count: 5, p_exclude: ev.id });
    const rows = (data ?? []).filter((r) => Number(r.capacity) > 0);
    if (!rows.length) return null;
    const pct = rows.map((r) => Math.min(100, Math.round((Number(r.sold) / Number(r.capacity)) * 100)));
    return {
      similarCount: rows.length,
      avgSellThroughPct: Math.round(pct.reduce((a, b) => a + b, 0) / pct.length),
      examples: rows.slice(0, 3).map((r, i) => ({ title: r.title, sellThroughPct: pct[i] })),
    };
  } catch {
    return null;
  }
}

// Assemble forecast features for one event and run the local predictor. Mirrors
// the feature mapping in analyticsController.getRevenueForecast so the AI
// revenue-tips task can reuse the same forecast without duplicating it in the
// controller. Returns { event, features, forecast } or null if not found.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function sgTimeParts(iso) {
  if (!iso) return { hour: null, dow: null };
  const d = new Date(iso);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', hourCycle: 'h23' }).format(d));
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', weekday: 'short' }).format(d);
  return { hour: Number.isFinite(hour) ? hour : null, dow: DOW[wd] ?? null };
}

const statusPrice = (ev, name) => (ev?.statuses ?? []).find((s) => s.statusName === name)?.price ?? 0;
const statusQty = (ev, name) => (ev?.statuses ?? []).find((s) => s.statusName === name)?.ticketCapacity ?? 0;

export async function forecastForEvent(eventId) {
  const admin = adminClient();
  const [{ data: events, error }, { data: row }] = await Promise.all([
    admin.rpc('get_events'),
    admin.from('EVENT').select('createdAt').eq('id', eventId).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);

  const ev = (events ?? []).find((e) => e.id === eventId);
  if (!ev) return null;

  const { hour, dow } = sgTimeParts(ev.startDate);
  const now = Date.now();
  const startMs = new Date(ev.startDate).getTime();

  const features = {
    postal_code: (String(ev.address ?? '').match(/\b\d{6}\b/) || [])[0] ?? null,
    start_hour: hour,
    day_of_week: dow,
    title: ev.title ?? '',
    description: ev.description ?? null,
    max_capacity: ev.maxCapacity ?? 0,
    hype_threshold: ev.hypeThreshold ?? 0,
    active_tickets: ev.active_ticket_count ?? 0,
    elapsed_hours: row?.createdAt ? Math.max(0, (now - new Date(row.createdAt).getTime()) / HOUR_MS) : 0,
    remaining_hours: ev.deadlineAt ? Math.max(0, (new Date(ev.deadlineAt).getTime() - now) / HOUR_MS) : 0,
    days_until_event: Number.isFinite(startMs) ? Math.max(0, Math.ceil((startMs - now) / DAY_MS)) : 0,
    pricing_model: ev.hypeDrivenPricing ? 'hype' : 'static',
    early_price: statusPrice(ev, 'early_bird'),
    greenlit_price: statusPrice(ev, 'greenlit'),
    early_capacity: statusQty(ev, 'early_bird'),
    greenlit_capacity: statusQty(ev, 'greenlit'),
    base_price: ev.basePrice ?? null,
    max_price: ev.maxPrice ?? null,
  };

  const forecast = await predictRevenue(features);
  forecast.benchmark = await similarPastBenchmark(admin, ev); // similar past events' real sell-through
  return { event: ev, features, forecast };
}
