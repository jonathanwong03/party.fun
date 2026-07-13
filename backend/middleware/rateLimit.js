import { getReadyRedis } from '../services/redisClient.js';

// Cross-instance rate limiting backed by Redis (INCR + EXPIRE on a per-window key).
// Fail-open: if Redis is off or errors, requests pass through — matching the rest of
// the backend's "Redis is a best-effort accelerator" stance. This is the server-side
// counterpart to the frontend's advisory resend cooldown.
//
//   rateLimit({ keyFn, limit, windowSec, message })
//     keyFn(req)   -> a stable identifier (e.g. phone/email + IP). Defaults to IP.
//     limit        -> max requests allowed per window
//     windowSec    -> window length in seconds
//
// Apply multiple instances to enforce both a short burst and a longer hourly cap.
export function rateLimit({ keyFn, limit, windowSec, message } = {}) {
  const resolveKey = typeof keyFn === 'function' ? keyFn : (req) => req.ip;

  return async function rateLimitMiddleware(req, res, next) {
    const redis = getReadyRedis();
    if (!redis) return next(); // Redis off / not yet connected → no limiting

    let count;
    try {
      const id = `rl:${windowSec}:${limit}:${resolveKey(req)}`;
      count = await redis.incr(id);
      if (count === 1) await redis.expire(id, windowSec);
    } catch (err) {
      console.warn('[rateLimit] check failed, allowing:', err?.message || err);
      return next(); // fail-open
    }

    if (count > limit) {
      res.status(429).json({
        status: 'rate_limited',
        message: message ?? 'Too many requests. Please wait a moment and try again.',
      });
      return;
    }
    next();
  };
}
