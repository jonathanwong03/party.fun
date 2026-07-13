import { computeEconomics, defaultCalculatorState, loadCalculator } from '../services/eventEconomics.js';
import { getAnalytics as readAnalytics } from '../services/eventService.js';
import { cacheDelByPrefix } from '../services/cache.js';

// Role-aware analytics: global discovery + (organiser) own-events + personal.
// The aggregation runs in the get_analytics() RPC (SECURITY DEFINER) so it can
// read across all organisers' bookings for the global ranking. Cached per-user.
export async function getAnalytics(req, res) {
  try {
    const data = await readAnalytics(req.supabase, req.user.id);
    if (data?.error) return res.status(400).json({ status: 'error', message: data.error });
    res.json(data);
  } catch (e) {
    res.status(400).json({ status: 'error', message: e.message });
  }
}

// Fetch one of the caller's manageable events (owner or accepted co-organiser). Uses
// the user-scoped get_events RPC so RLS + can_manage_event decide visibility/ownership.
async function manageableEvent(req, eventId) {
  const { data: events, error } = await req.supabase.rpc('get_events');
  if (error) return { error: error.message };
  const ev = (events ?? []).find((e) => e.id === eventId);
  if (!ev) return { notFound: true };
  const isManager = ev.hostId === req.user.id || ev.canEdit || ev.isCoOrganiser || req.user.role === 'admin';
  if (!isManager) return { forbidden: true };
  return { ev };
}

// GET /api/analytics/calculator/:eventId — the saved profit-calculator state (or the
// prefilled defaults from the event's pricing) plus the computed economics.
export async function getCalculator(req, res) {
  const { ev, error, notFound, forbidden } = await manageableEvent(req, req.params.eventId);
  if (error) return res.status(400).json({ status: 'error', message: error });
  if (notFound) return res.status(404).json({ status: 'not_found', message: 'Event not found.' });
  if (forbidden) return res.status(403).json({ status: 'forbidden', message: 'Not your event.' });

  const state = await loadCalculator(req.supabase, ev, req.user.id);
  res.json({ available: true, eventId: ev.id, title: ev.title, state, economics: computeEconomics(state) });
}

// PUT /api/analytics/calculator/:eventId — persist the calculator state (RLS enforces
// that only the event's manager can write). Returns the recomputed economics.
export async function saveCalculator(req, res) {
  const { ev, error, notFound, forbidden } = await manageableEvent(req, req.params.eventId);
  if (error) return res.status(400).json({ status: 'error', message: error });
  if (notFound) return res.status(404).json({ status: 'not_found', message: 'Event not found.' });
  if (forbidden) return res.status(403).json({ status: 'forbidden', message: 'Not your event.' });

  const incoming = req.body?.state;
  const state = incoming && typeof incoming === 'object' ? incoming : defaultCalculatorState(ev);
  const { error: upErr } = await req.supabase
    .from('EVENT_CALCULATOR')
    .upsert({ eventId: ev.id, state, updatedAt: new Date().toISOString() }, { onConflict: 'eventId' });
  if (upErr) return res.status(400).json({ status: 'error', message: upErr.message });
  // The saved calculator changed → drop its cache (and analytics, which reflects it).
  await Promise.all([cacheDelByPrefix('data:calculator:'), cacheDelByPrefix('data:analytics:')]);

  res.json({ available: true, eventId: ev.id, state, economics: computeEconomics(state) });
}
