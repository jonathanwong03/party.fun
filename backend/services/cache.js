import { getReadyRedis, isRedisEnabled } from './redisClient.js';

// Fail-open cache helpers over the optional Redis client. Every function swallows
// Redis errors and behaves as a cache miss / no-op, so a Redis outage degrades to
// "no caching" rather than breaking requests. When REDIS_URL is unset the getters
// return null and the loaders run directly.

export { isRedisEnabled };

// Parsed JSON value for `key`, or null on miss / error / Redis-off.
export async function cacheGetJson(key) {
  const redis = getReadyRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw == null ? null : JSON.parse(raw);
  } catch (err) {
    console.warn('[cache] get failed:', key, err?.message || err);
    return null;
  }
}

// Best-effort SET with a TTL in seconds. Returns true on success, false otherwise.
export async function cacheSetJson(key, value, ttlSeconds) {
  const redis = getReadyRedis();
  if (!redis) return false;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttlSeconds)));
    return true;
  } catch (err) {
    console.warn('[cache] set failed:', key, err?.message || err);
    return false;
  }
}

// Delete one or more keys. Safe to call with no keys.
export async function cacheDel(...keys) {
  const redis = getReadyRedis();
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    console.warn('[cache] del failed:', keys, err?.message || err);
  }
}

// Delete every key beginning with `prefix`. Uses SCAN (not KEYS) so it never blocks
// the Redis server on large keyspaces.
export async function cacheDelByPrefix(prefix) {
  const redis = getReadyRedis();
  if (!redis) return;
  try {
    const stream = redis.scanStream({ match: `${prefix}*`, count: 100 });
    const batch = [];
    for await (const keys of stream) {
      if (keys.length) batch.push(...keys);
    }
    if (batch.length) await redis.del(...batch);
  } catch (err) {
    console.warn('[cache] delByPrefix failed:', prefix, err?.message || err);
  }
}

// Get-or-load: return the cached value for `key`, or run `loader()`, cache its
// result for `ttlSeconds`, and return it. When Redis is off this is just `loader()`.
// A loader result of null/undefined is returned but not cached.
export async function withCache(key, ttlSeconds, loader) {
  const hit = await cacheGetJson(key);
  if (hit != null) return hit;
  const value = await loader();
  if (value != null) await cacheSetJson(key, value, ttlSeconds);
  return value;
}

// ── Stale-while-revalidate ────────────────────────────────────────────────────
// For reads whose loader is expensive (e.g. the get_events RPC, ~3s uncached) but whose
// data only needs to be seconds-fresh. The value is stored as an envelope { v, f } under a
// PHYSICAL ttl of fresh+stale seconds:
//   • miss                → run the loader (blocking), cache, return
//   • hit, now <  f       → fresh: return immediately
//   • hit, now >= f       → STALE: return the cached value immediately AND refresh in the
//                           background, so nobody waits on the slow path
// Only after fresh+stale seconds of zero traffic does a request pay the loader again.
// Keeps the fail-open contract: Redis off/erroring ⇒ behaves exactly like `loader()`.

// One in-flight background refresh per key (per process) so a burst of stale hits triggers
// a single reload rather than a stampede.
const inFlight = new Map();

// Monotonic generation guarding SWR write-backs against the classic stale-vs-invalidate race:
// a refresh whose loader read data BEFORE an invalidation must not write that now-stale snapshot
// back after the invalidation cleared the key. Callers bump this in their write-invalidation path
// (e.g. invalidateEventCaches). Per-process — matches the app's single-instance assumption.
let swrGeneration = 0;
export function bumpSwrGeneration() { swrGeneration += 1; }

function refreshInBackground(key, freshTtlS, staleTtlS, loader) {
  if (inFlight.has(key)) return;
  const startGen = swrGeneration;
  const task = (async () => {
    try {
      const value = await loader();
      // Skip the write-back if an invalidation happened while we were loading — the value is stale.
      if (value != null && startGen === swrGeneration) await cacheSetJson(key, envelope(value, freshTtlS), freshTtlS + staleTtlS);
    } catch (err) {
      // Serving stale already succeeded — a failed refresh just means we retry next hit.
      console.warn('[cache] background refresh failed:', key, err?.message || err);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
}

const envelope = (value, freshTtlS) => ({ v: value, f: Date.now() + freshTtlS * 1000 });
// Envelopes written by this helper. Anything else (e.g. a value cached by the older
// withCache/cacheSetJson path) is treated as a miss and self-heals on the next write.
const isEnvelope = (x) => !!x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && typeof x.f === 'number';

export async function withSwrCache(key, freshTtlS, staleTtlS, loader) {
  const startGen = swrGeneration;
  const hit = await cacheGetJson(key);
  if (isEnvelope(hit)) {
    if (Date.now() < hit.f) return hit.v;                       // fresh
    refreshInBackground(key, freshTtlS, staleTtlS, loader);     // stale → refresh behind the scenes
    return hit.v;                                               // …but answer instantly
  }
  const value = await loader();
  // Same guard as the background path: don't cache a snapshot that an invalidation raced past.
  if (value != null && startGen === swrGeneration) await cacheSetJson(key, envelope(value, freshTtlS), freshTtlS + staleTtlS);
  return value;
}

// Test seam: await any in-flight background refresh for deterministic assertions.
export async function __swrSettled() {
  await Promise.all([...inFlight.values()]);
}
