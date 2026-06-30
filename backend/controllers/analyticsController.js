import { adminClient } from '../services/supabaseAdmin.js';
import { predictRevenue } from '../services/revenueForecaster.js';

// Role-aware analytics: global discovery + (organiser) own-events + personal.
// The aggregation runs in the get_analytics() RPC (SECURITY DEFINER) so it can
// read across all organisers' bookings for the global ranking.
export async function getAnalytics(req, res) {
  const { data, error } = await req.supabase.rpc('get_analytics');
  if (error) return res.status(400).json({ status: 'error', message: error.message });
  if (data?.error) return res.status(400).json({ status: 'error', message: data.error });
  res.json(data);
}

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

// GET /api/analytics/forecast/:eventId — assemble features and run the local
// monolith predictor for expected ticket sales and ticket revenue.
export async function getRevenueForecast(req, res) {
  const eventId = req.params.eventId;
  const admin = adminClient();

  const [{ data: events, error: evErr }, { data: row }] = await Promise.all([
    admin.rpc('get_events'),
    admin.from('EVENT').select('createdAt').eq('id', eventId).maybeSingle(),
  ]);
  if (evErr) return res.status(400).json({ status: 'error', message: evErr.message });

  const ev = (events ?? []).find((e) => e.id === eventId);
  if (!ev) return res.status(404).json({ status: 'not_found', message: 'Event not found.' });

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
  if (!forecast) return res.json({ available: false });
  res.json({ available: true, ...forecast });
}
