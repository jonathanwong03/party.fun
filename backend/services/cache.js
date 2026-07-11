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
