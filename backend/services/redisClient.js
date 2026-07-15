import Redis from 'ioredis';

// Optional managed-Redis (Upstash/Redis Cloud) connection. When REDIS_URL is unset
// — local dev, CI, tests — this stays null and every caller falls back to its
// existing in-memory behaviour, so nothing regresses. Connect over TLS with a
// `rediss://` URL from Upstash.
//
// The client is created lazily and is fail-open: connection/command errors are
// logged but never crash the process. The rest of the backend treats Redis as a
// best-effort accelerator, not a source of truth.

let client = null;
let initialised = false;

export function getRedis() {
  if (initialised) return client;
  initialised = true;

  const url = process.env.REDIS_URL;
  if (!url) return (client = null);

  client = new Redis(url, {
    // Don't queue commands forever if Redis is unreachable — fail fast so callers
    // fall back instead of hanging a request.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
  });

  client.on('error', (err) => {
    console.warn('[redis] error:', err?.message || err);
  });
  client.on('connect', () => console.log('[redis] connected'));

  return client;
}

// The client only if it's fully connected and ready to accept commands. During the
// initial TLS handshake (or a reconnect) ioredis reports a non-'ready' status; issuing
// a command then throws "Stream isn't writeable". Callers use this to skip the cache
// silently (a plain miss) instead of attempting — and logging — a doomed command.
export function getReadyRedis() {
  const c = getRedis();
  return c && c.status === 'ready' ? c : null;
}

export function isRedisEnabled() {
  return !!process.env.REDIS_URL;
}

// Test seams: swap in a fake client (needs `status: 'ready'` to be handed out by
// getReadyRedis) so the cache helpers can be tested without a real Redis.
export function __setRedisForTests(fake) {
  client = fake;
  initialised = true;
}
export function __resetRedisForTests() {
  client = null;
  initialised = false;
}
