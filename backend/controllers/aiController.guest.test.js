import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// anyConfigured()/isConfigured() read the key at call time, so setting it here is enough to
// get past the availability guard. No LLM call happens: recommendEvents returns early when
// there are no candidates, so this test never touches the network.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';

const { recommendEvents } = await import('./aiController.js');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// optionalAuth gives guests `req.user = null` + the anon Supabase client.
const guestReq = (over = {}) => ({
  body: { interests: 'live music' },
  user: null,
  supabase: { rpc: async () => ({ data: [], error: null }) },
  ip: `guest-${Math.random()}`, // unique so the per-caller rate limit never bites
  headers: {},
  ...over,
});

afterEach(() => { /* no global state to reset */ });

test('recommendEvents works for a signed-out guest (req.user is null)', async () => {
  const res = makeRes();
  await recommendEvents(guestReq(), res);

  // Regression: this used to deref req.user.id → TypeError → caught → HTTP 400 for guests.
  assert.equal(res.statusCode, 200);
  assert.ok(res.body, 'guest should get a body, not an error');
  assert.deepEqual(res.body.recommendations, [], 'reached the recommender (no events → no picks)');
});

test('recommendEvents still works for a signed-in user', async () => {
  const res = makeRes();
  await recommendEvents(guestReq({ user: { id: 'u1' }, ip: undefined }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.recommendations, []);
});
