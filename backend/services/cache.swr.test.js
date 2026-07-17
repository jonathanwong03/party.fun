import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { withSwrCache, __swrSettled } from './cache.js';
import { __setRedisForTests, __resetRedisForTests } from './redisClient.js';

// Minimal in-memory stand-in for the bits cacheGetJson/cacheSetJson use. Expiry isn't
// simulated — staleness is driven by the envelope's own `f` timestamp, which we control
// via freshTtlS, so the tests stay deterministic (no sleeping).
function fakeRedis() {
  const store = new Map();
  return {
    status: 'ready',
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, v); return 'OK'; },
  };
}

afterEach(() => __resetRedisForTests());

test('miss → runs the loader once and caches the result', async () => {
  const redis = fakeRedis();
  __setRedisForTests(redis);
  let calls = 0;
  const load = async () => { calls += 1; return [{ id: 'e1' }]; };

  assert.deepEqual(await withSwrCache('k', 60, 600, load), [{ id: 'e1' }]);
  assert.equal(calls, 1);
  assert.ok(redis.store.has('k'));
});

test('fresh hit → served from cache, loader not called again', async () => {
  __setRedisForTests(fakeRedis());
  let calls = 0;
  const load = async () => { calls += 1; return ['v']; };

  await withSwrCache('k', 60, 600, load);
  const second = await withSwrCache('k', 60, 600, load);

  assert.deepEqual(second, ['v']);
  assert.equal(calls, 1, 'a fresh entry must not re-run the loader');
});

test('stale hit → returns the OLD value immediately and refreshes in the background', async () => {
  __setRedisForTests(fakeRedis());
  let calls = 0;
  const load = async () => { calls += 1; return [`load-${calls}`]; };

  // freshTtl 0 → the entry is stale the moment it is written.
  await withSwrCache('k', 0, 600, load);
  assert.equal(calls, 1);

  // The stale read answers with the cached value WITHOUT awaiting the reload.
  const stale = await withSwrCache('k', 0, 600, load);
  assert.deepEqual(stale, ['load-1'], 'stale value is served instantly');

  // …and a background refresh repopulates the cache.
  await __swrSettled();
  assert.equal(calls, 2, 'a stale hit triggers exactly one background reload');
  const after = await withSwrCache('k', 60, 600, load);
  assert.deepEqual(after, ['load-2'], 'the refreshed value replaced the stale one');
});

test('concurrent stale hits trigger only ONE background refresh (no stampede)', async () => {
  __setRedisForTests(fakeRedis());
  let calls = 0;
  const load = async () => { calls += 1; return ['v']; };

  await withSwrCache('k', 0, 600, load); // seed (stale immediately)
  assert.equal(calls, 1);

  await Promise.all([
    withSwrCache('k', 0, 600, load),
    withSwrCache('k', 0, 600, load),
    withSwrCache('k', 0, 600, load),
  ]);
  await __swrSettled();

  assert.equal(calls, 2, 'three stale hits must collapse into a single reload');
});

test('a legacy (non-envelope) cached value is treated as a miss', async () => {
  const redis = fakeRedis();
  redis.store.set('k', JSON.stringify([{ id: 'old' }])); // written by the old withCache path
  __setRedisForTests(redis);
  let calls = 0;
  const load = async () => { calls += 1; return [{ id: 'new' }]; };

  assert.deepEqual(await withSwrCache('k', 60, 600, load), [{ id: 'new' }]);
  assert.equal(calls, 1, 'legacy value must not be served as if it were an envelope');
});

test('Redis off → fails open to the loader', async () => {
  __setRedisForTests(null);
  let calls = 0;
  const load = async () => { calls += 1; return ['live']; };

  assert.deepEqual(await withSwrCache('k', 60, 600, load), ['live']);
  assert.deepEqual(await withSwrCache('k', 60, 600, load), ['live']);
  assert.equal(calls, 2, 'with no cache every call hits the loader');
});
