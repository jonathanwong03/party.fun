// Weather service — Google Maps Platform Weather API (forecast/days:lookup).
// Used to warn organisers/attendees when an event's day is likely to be rainy
// (precipitation probability over the threshold), which matters for outdoor events.
//
// party.fun is Singapore-only, so daily rain probability is effectively city-wide:
// callers that know the exact venue coordinates (the Create/Edit form via the
// AddressPicker) pass them for precision; everything else falls back to Singapore.
// Node 22 has a global `fetch`, so no HTTP dependency is needed.

import { isRedisEnabled, cacheGetJson, cacheSetJson } from './cache.js';

const SINGAPORE = { lat: 1.3521, lon: 103.8198 };
const RAIN_THRESHOLD_PCT = 70; // "> 70% chance of precipitation" → warn
const HORIZON_DAYS = 10; // Google's daily forecast reaches ~10 days
const WEATHER_FETCH_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min per location
const CACHE_TTL_S = CACHE_TTL_MS / 1000;

// In-memory fallback used when Redis is off (local dev, tests). With Redis on, the
// forecast is cached there instead so the 30-min TTL is shared across instances.
const cache = new Map(); // `${lat.toFixed(2)},${lon.toFixed(2)}` -> { at, days }

// Real fetch against the Weather API. Returns the `forecastDays` array, or null
// when no API key is configured (so the feature degrades to "unavailable").
let warnedNoKey = false;
async function defaultFetchForecast(lat, lon) {
  const key = process.env.GOOGLE_WEATHER_API_KEY;
  if (!key) {
    if (!warnedNoKey) { warnedNoKey = true; console.warn('[weather] GOOGLE_WEATHER_API_KEY is not set — weather checks are disabled.'); }
    return null;
  }
  // `days` is the total requested; `pageSize` caps records PER PAGE and defaults to 5 — so
  // without it this returned only ~5 days and every later date looked like it had no forecast.
  const url = `https://weather.googleapis.com/v1/forecast/days:lookup?key=${encodeURIComponent(key)}`
    + `&location.latitude=${lat}&location.longitude=${lon}&days=${HORIZON_DAYS}&pageSize=${HORIZON_DAYS}`;
  // Bound the call so a hung provider degrades to "unavailable" (assessEvent catches) instead of
  // stalling the request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Weather API ${res.status}`);
    const json = await res.json();
    return Array.isArray(json?.forecastDays) ? json.forecastDays : [];
  } finally {
    clearTimeout(timer);
  }
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

// The YYYY-MM-DD `n` days after `ymd`. (Singapore has no DST, so plain UTC date arithmetic
// on an already-SGT-normalised label is safe.)
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Inclusive list of YYYY-MM-DD calendar days from startYmd to endYmd, capped to
// `cap` days. (Singapore has no DST, so plain UTC date arithmetic on the labels is safe.)
function daysInRange(startYmd, endYmd, cap) {
  const out = [];
  const d = new Date(`${startYmd}T00:00:00Z`);
  const end = new Date(`${(endYmd && endYmd >= startYmd) ? endYmd : startYmd}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  while (d <= end && out.length < cap) {
    out.push(fmt.format(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
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

  // Redis path (shared, persisted). Only used when a real fetcher is active — tests
  // inject a seam and run with Redis off, so they always take the in-memory path.
  if (isRedisEnabled() && dependencies.fetchForecast === defaultFetchForecast) {
    const cached = await cacheGetJson(`wx:${key}`);
    if (cached != null) return cached;
    const days = await dependencies.fetchForecast(lat, lon);
    if (days == null) return null; // unavailable (no key)
    await cacheSetJson(`wx:${key}`, days, CACHE_TTL_S);
    return days;
  }

  // In-memory fallback.
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
  // Decide "too far away" by COMPARING DATES, before looking at the forecast at all. This
  // used to be inferred from "no forecast day matched", which conflated two different things:
  // a short/empty API response then reported TOMORROW as "more than 10 days away".
  if (startYmd > addDays(todayYmd, HORIZON_DAYS)) {
    return { status: 'beyond_horizon', precipitationProbability: null, willRain: false, days: [], rainyDays: [], summary: `That date is more than ${HORIZON_DAYS} days away, which is too far out for a reliable forecast.` };
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

  // Every calendar day the event spans (start..end inclusive), capped to the horizon.
  const endYmd = endISO ? sgYmd(endISO) : startYmd;
  const wantedList = daysInRange(startYmd, endYmd, HORIZON_DAYS + 1);
  const byYmd = new Map(days.map((d) => [dayYmd(d), d]).filter(([k]) => k));

  const perDay = []; // { date, probability, willRain } for each spanned day we have a forecast for
  const probs = [];
  for (const ymd of wantedList) {
    const day = byYmd.get(ymd);
    if (!day) continue;
    const p = dayPrecipProb(day);
    perDay.push({ date: ymd, probability: p, willRain: p != null && p > RAIN_THRESHOLD_PCT });
    if (p != null) probs.push(p);
  }

  // The date IS inside the horizon (checked above) but the provider returned nothing for it —
  // a short page, an outage, a response-shape change. Say so honestly; never claim it's too
  // far away, which is what sent "will it rain tomorrow?" back as "more than 10 days away".
  if (perDay.length === 0) {
    console.warn(`[weather] no forecast day for ${startYmd}..${endYmd} within the ${HORIZON_DAYS}-day horizon (got ${days.length} day(s) from the provider)`);
    return { status: 'unavailable', precipitationProbability: null, willRain: false, days: [], rainyDays: [], summary: 'The forecast for that date could not be retrieved right now.' };
  }

  const probability = probs.length ? Math.max(...probs) : null;
  const willRain = probability != null && probability > RAIN_THRESHOLD_PCT;
  const rainyDays = perDay.filter((d) => d.willRain).map((d) => d.date);
  const summary = probability == null
    ? 'Forecast found, but no precipitation reading is available for those days.'
    : willRain
      ? `High chance of rain (up to ${probability}%) on ${rainyDays.length > 1 ? `${rainyDays.length} of the event days (${rainyDays.join(', ')})` : rainyDays[0]} — not ideal for an outdoor event; consider an indoor venue or another date.`
      : `Weather looks fine (up to ${probability}% chance of rain) across the event.`;

  return { status: 'ok', precipitationProbability: probability, willRain, days: perDay, rainyDays, summary };
}

export const WEATHER = { RAIN_THRESHOLD_PCT, HORIZON_DAYS, SINGAPORE };
