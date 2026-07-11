import { isRedisEnabled, cacheGetJson, cacheSetJson, cacheDel } from './cache.js';

// A short-lived keyed store for OTP / password-reset codes. Backed by Redis when
// REDIS_URL is set (so codes survive restarts and are shared across instances) and
// by an in-memory Map otherwise — preserving the previous single-process behaviour.
//
// The stored entry carries its own `expiresAt`, which remains the source of truth
// for validity (callers can distinguish expired from invalid). The Redis TTL is set
// a little beyond that purely so stale keys get reclaimed.
export function makeCodeStore(prefix, ttlMs) {
  const map = new Map(); // key -> entry (only used when Redis is off)
  const redisTtlS = Math.ceil(ttlMs / 1000) + 60;
  const rkey = (key) => `${prefix}${key}`;

  async function get(key) {
    if (isRedisEnabled()) return cacheGetJson(rkey(key));
    const entry = map.get(key);
    return entry ?? null;
  }

  async function set(key, entry) {
    if (isRedisEnabled()) {
      await cacheSetJson(rkey(key), entry, redisTtlS);
      return;
    }
    map.set(key, entry);
  }

  async function del(key) {
    if (isRedisEnabled()) {
      await cacheDel(rkey(key));
      return;
    }
    map.delete(key);
  }

  return { get, set, del };
}
