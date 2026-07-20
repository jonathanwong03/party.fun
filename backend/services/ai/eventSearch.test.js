import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { matchEventsHybrid } from './eventSearch.js';
import { __setEmbedForTests, __resetEmbedForTests } from './embeddingService.js';

afterEach(() => {
  __resetEmbedForTests();
  delete process.env.GEMINI_API_KEY; // embeddings stay OFF unless a test opts in
});

const sbWith = (handler) => ({ rpc: async (name, args) => handler(name, args) });

test('blank query short-circuits without touching the database', async () => {
  let called = false;
  const sb = sbWith(() => { called = true; return { data: [], error: null }; });
  assert.deepEqual(await matchEventsHybrid(sb, '   '), []);
  assert.equal(called, false);
});

test('searches keyword-only when embeddings are OFF (previously returned nothing)', async () => {
  // The whole point of hybrid: an exact-name lookup still works with no embedding at all,
  // so search keeps functioning when the key is unset or an event isn't backfilled.
  let seen = null;
  const sb = sbWith((name, args) => {
    seen = { name, args };
    return { data: [{ eventId: 'e1', similarity: null, score: 0.016 }], error: null };
  });
  const out = await matchEventsHybrid(sb, 'Springleaf prata', { count: 5 });
  assert.equal(seen.name, 'match_events_hybrid');
  assert.equal(seen.args.p_query, 'Springleaf prata');
  assert.equal(seen.args.p_embedding, null, 'no vector is sent when embeddings are off');
  assert.deepEqual(out, [{ eventId: 'e1', similarity: null, score: 0.016 }]);
});

test('sends both the query text and the vector when embeddings are ON', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  __setEmbedForTests(async () => [0.1, 0.2, 0.3]);
  let seen = null;
  const sb = sbWith((name, args) => {
    seen = { name, args };
    return { data: [{ eventId: 'e1', similarity: 0.83, score: 0.03 }], error: null };
  });
  const out = await matchEventsHybrid(sb, 'chill supper', { count: 7, exclude: 'e9' });
  assert.equal(seen.name, 'match_events_hybrid');
  assert.equal(seen.args.p_query, 'chill supper');
  assert.equal(seen.args.p_embedding, '[0.1,0.2,0.3]');
  assert.equal(seen.args.p_count, 7);
  assert.equal(seen.args.p_exclude, 'e9');
  // similarity stays the COSINE value (callers gate confidence on it), score is the RRF fusion.
  assert.deepEqual(out, [{ eventId: 'e1', similarity: 0.83, score: 0.03 }]);
});

test('falls back to vector-only match_events when the hybrid RPC is missing', async () => {
  // Lets the code ship before the migration is applied.
  process.env.GEMINI_API_KEY = 'test-key';
  __setEmbedForTests(async () => [0.4, 0.5]);
  const names = [];
  const sb = sbWith((name) => {
    names.push(name);
    if (name === 'match_events_hybrid') return { data: null, error: { message: 'function does not exist' } };
    return { data: [{ eventId: 'e2', similarity: 0.77 }], error: null };
  });
  const out = await matchEventsHybrid(sb, 'rooftop party');
  assert.deepEqual(names, ['match_events_hybrid', 'match_events']);
  assert.deepEqual(out, [{ eventId: 'e2', similarity: 0.77 }]);
});

test('returns [] when the hybrid RPC fails and there is no vector to fall back on', async () => {
  const names = [];
  const sb = sbWith((name) => {
    names.push(name);
    return { data: null, error: { message: 'boom' } };
  });
  assert.deepEqual(await matchEventsHybrid(sb, 'anything'), []);
  assert.deepEqual(names, ['match_events_hybrid'], 'never calls match_events with a null vector');
});
