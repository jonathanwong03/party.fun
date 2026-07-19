import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from './rateLimit.js';
import { __setRedisForTests, __resetRedisForTests } from '../services/redisClient.js';

// Minimal in-memory Redis exposing just what rateLimit uses (incr + expire), reported ready.
function fakeRedis() {
  const store = new Map();
  return {
    status: 'ready',
    async incr(k) { const v = (store.get(k) ?? 0) + 1; store.set(k, v); return v; },
    async expire() { return 1; },
  };
}
function mockRes() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

afterEach(() => __resetRedisForTests());

test('rateLimit allows up to the limit, then 429s — and only for that key', async () => {
  __setRedisForTests(fakeRedis());
  const mw = rateLimit({ keyFn: (req) => req.user.id, limit: 10, windowSec: 20, message: 'slow down' });
  const req = { user: { id: 'u1' } };
  let passed = 0;
  for (let i = 0; i < 10; i += 1) {
    const res = mockRes();
    await mw(req, res, () => { passed += 1; });
    assert.equal(res.code, 200, `call ${i + 1} should pass`);
  }
  assert.equal(passed, 10);

  const res11 = mockRes();
  await mw(req, res11, () => { passed += 1; });
  assert.equal(res11.code, 429, 'the 11th call within the window is throttled');
  assert.equal(res11.body.status, 'rate_limited');
  assert.equal(res11.body.message, 'slow down');
  assert.equal(passed, 10, 'next() not called on a throttled request');

  // A different user has their own budget.
  const other = mockRes();
  await mw({ user: { id: 'u2' } }, other, () => { passed += 1; });
  assert.equal(other.code, 200);
  assert.equal(passed, 11);
});

test('rateLimit fails open when Redis is unavailable (dev / no REDIS_URL)', async () => {
  __resetRedisForTests(); // no fake injected → getReadyRedis returns null
  const mw = rateLimit({ keyFn: () => 'k', limit: 1, windowSec: 20 });
  let passed = 0;
  for (let i = 0; i < 5; i += 1) await mw({}, mockRes(), () => { passed += 1; });
  assert.equal(passed, 5, 'all requests pass through when Redis is off');
});
