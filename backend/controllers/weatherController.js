import { assessEvent } from '../services/weatherService.js';

// GET /api/weather — rain assessment for an event's window.
//   ?eventId=…                       → uses that event's stored date/time (Singapore-level).
//   ?lat=&lon=&start=&end=           → uses exact coordinates (the Create/Edit form,
//                                       where the AddressPicker already knows the venue).
// Returns { status, precipitationProbability, willRain, summary } (never throws).
export async function getWeather(req, res) {
  const { eventId, lat, lon, start, end } = req.query ?? {};
  let startISO = start;
  let endISO = end;
  let la = lat;
  let lo = lon;

  if (eventId) {
    const { data, error } = await req.supabase.rpc('get_events');
    if (error) return res.status(400).json({ status: 'error', message: error.message });
    const ev = (data ?? []).find((e) => e.id === eventId);
    if (!ev) return res.status(404).json({ status: 'not_found', message: 'Event not found.' });
    startISO = startISO || ev.startDate;
    endISO = endISO || ev.endDate;
    // Use the event's stored venue coordinates (falls back to Singapore inside assessEvent).
    if (la == null) la = ev.latitude;
    if (lo == null) lo = ev.longitude;
  }

  const result = await assessEvent({ lat: la, lon: lo, startISO, endISO });
  res.json(result);
}
