// Weather service — Google Maps Platform Weather API (forecast/days:lookup).
// Used to warn organisers/attendees when an event's day is likely to be rainy
// (precipitation probability over the threshold), which matters for outdoor events.
//
// party.fun is Singapore-only, so daily rain probability is effectively city-wide:
// callers that know the exact venue coordinates (the Create/Edit form via the
// AddressPicker) pass them for precision; everything else falls back to Singapore.
// Node 22 has a global `fetch`, so no HTTP dependency is needed.

const SINGAPORE = { lat: 1.3521, lon: 103.8198 };
const RAIN_THRESHOLD_PCT = 70; // "> 70% chance of precipitation" → warn
const HORIZON_DAYS = 10; // Google's daily forecast reaches ~10 days
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min per location

const cache = new Map(); // `${lat.toFixed(2)},${lon.toFixed(2)}` -> { at, days }

// Real fetch against the Weather API. Returns the `forecastDays` array, or null
// when no API key is configured (so the feature degrades to "unavailable").
async function defaultFetchForecast(lat, lon) {
  const key = process.env.GOOGLE_WEATHER_API_KEY;
  if (!key) return null;
  const url = `https://weather.googleapis.com/v1/forecast/days:lookup?key=${encodeURIComponent(key)}`
    + `&location.latitude=${lat}&location.longitude=${lon}&days=${HORIZON_DAYS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.forecastDays) ? json.forecastDays : [];
}

// Test seam: inject a synthetic forecast so tests never hit the network. Setting
// or resetting the seam also clears the cache so injected forecasts take effect.
export const dependencies = { fetchForecast: defaultFetchForecast };
export function __setForecastForTests(fn) { dependencies.fetchForecast = fn; cache.clear(); }
export function __resetForecastForTests() { dependencies.fetchForecast = defaultFetchForecast; cache.clear(); }

// A calendar date (YYYY-MM-DD) in Singapore time — the app's canonical timezone.
function sgYmd(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// The YYYY-MM-DD a Weather API forecastDay refers to (it carries a displayDate,
// with the interval as a fallback).
function dayYmd(day) {
  const dd = day?.displayDate;
  if (dd?.year && dd?.month && dd?.day) {
    return `${dd.year}-${String(dd.month).padStart(2, '0')}-${String(dd.day).padStart(2, '0')}`;
  }
  const start = day?.interval?.startTime;
  return start ? sgYmd(start) : null;
}

// Highest precipitation probability (%) across a day's day/night sub-forecasts.
function dayPrecipProb(day) {
  const probs = [day?.daytimeForecast, day?.nighttimeForecast]
    .map((f) => f?.precipitation?.probability?.percent)
    .filter((n) => Number.isFinite(n));
  return probs.length ? Math.max(...probs) : null;
}

async function getForecastDays(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.days;
  const days = await dependencies.fetchForecast(lat, lon);
  if (days == null) return null; // unavailable (no key)
  cache.set(key, { at: Date.now(), days });
  return days;
}

// Assess an event's window. Coordinates are optional (Singapore fallback).
// Returns:
//   status: 'ok' | 'past' | 'beyond_horizon' | 'unavailable'
//   precipitationProbability: number | null   (max % across the event's day(s))
//   willRain: boolean                          (probability > 70%)
//   summary: string                            (human-readable, no emojis)
export async function assessEvent({ lat, lon, startISO, endISO } = {}) {
  const la = Number.isFinite(Number(lat)) ? Number(lat) : SINGAPORE.lat;
  const lo = Number.isFinite(Number(lon)) ? Number(lon) : SINGAPORE.lon;

  const startYmd = startISO ? sgYmd(startISO) : null;
  if (!startYmd) return { status: 'unavailable', precipitationProbability: null, willRain: false, summary: 'No event date to check the weather for.' };

  const todayYmd = sgYmd(new Date().toISOString());
  if (startYmd < todayYmd) {
    return { status: 'past', precipitationProbability: null, willRain: false, summary: 'That date is in the past, so there is no forecast for it.' };
  }

  let days;
  try {
    days = await getForecastDays(la, lo);
  } catch {
    return { status: 'unavailable', precipitationProbability: null, willRain: false, summary: 'Weather forecast is unavailable right now.' };
  }
  if (days == null) {
    return { status: 'unavailable', precipitationProbability: null, willRain: false, summary: 'Weather forecast is not configured.' };
  }

  // The set of calendar days the event spans (start..end), capped for safety.
  const endYmd = endISO ? sgYmd(endISO) : startYmd;
  const wanted = new Set([startYmd, endYmd].filter(Boolean));
  const byYmd = new Map(days.map((d) => [dayYmd(d), d]).filter(([k]) => k));

  const probs = [];
  let anyMatched = false;
  for (const ymd of wanted) {
    const day = byYmd.get(ymd);
    if (!day) continue;
    anyMatched = true;
    const p = dayPrecipProb(day);
    if (p != null) probs.push(p);
  }

  if (!anyMatched) {
    return { status: 'beyond_horizon', precipitationProbability: null, willRain: false, summary: `That date is more than ${HORIZON_DAYS} days away, which is too far out for a reliable forecast.` };
  }

  const probability = probs.length ? Math.max(...probs) : null;
  const willRain = probability != null && probability > RAIN_THRESHOLD_PCT;
  const summary = probability == null
    ? 'Forecast found, but no precipitation reading is available for that day.'
    : willRain
      ? `High chance of rain (${probability}%) around that time — not ideal for an outdoor event; consider an indoor venue or another date.`
      : `Weather looks fine (${probability}% chance of rain) for that time.`;

  return { status: 'ok', precipitationProbability: probability, willRain, summary };
}

export const WEATHER = { RAIN_THRESHOLD_PCT, HORIZON_DAYS, SINGAPORE };
