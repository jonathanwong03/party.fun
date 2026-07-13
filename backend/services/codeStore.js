import { isRedisEnabled, cacheGetJson, cacheSetJson, cacheDel } from './cache.js';

// A short-lived keyed store for OTP / password-reset codes. Backed by Redis when
// REDIS_URL is set (so codes survive restarts and are shared across instances) and
// by an in-memory Map otherwise — preserving the previous single-process behaviour.
//
// The stored entry carries its own `expiresAt`, which remains the source of truth
// for validity (callers can distinguish expired from invalid). The Redis TTL is set
// a little beyond that purely so stale keys get reclaimed.
//
// get/set/del return a Promise when Redis is on and a plain value when it's off.
// Callers always `await`, so both work; unit tests (which run with Redis off) can
// also read the store synchronously. `has`/`clear` are in-memory helpers for tests.
export function makeCodeStore(prefix, ttlMs) {
  const map = new Map(); // key -> entry (used when Redis is off)
  const redisTtlS = Math.ceil(ttlMs / 1000) + 60;
  const rkey = (key) => `${prefix}${key}`;

  return {
    get(key) {
      if (isRedisEnabled()) return cacheGetJson(rkey(key));
      return map.get(key) ?? null;
    },
    set(key, entry) {
      if (isRedisEnabled()) return cacheSetJson(rkey(key), entry, redisTtlS);
      map.set(key, entry);
      return undefined;
    },
    del(key) {
      if (isRedisEnabled()) return cacheDel(rkey(key));
      map.delete(key);
      return undefined;
    },
    has(key) {
      return map.has(key);
    },
    clear() {
      map.clear();
    },
  };
}
