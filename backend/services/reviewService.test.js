import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitReview, listReviews, listReviewableEvents } from './reviewService.js';

function sbWith(handler) {
  return { rpc: async (name, args) => handler(name, args) };
}

test('submitReview passes args and returns ok', async () => {
  let seen = null;
  const sb = sbWith((name, args) => { seen = { name, args }; return { data: { status: 'ok' }, error: null }; });
  const res = await submitReview(sb, 'evt-1', 5, 'Great night');
  assert.deepEqual(res, { status: 'ok' });
  assert.equal(seen.name, 'submit_review');
  assert.deepEqual(seen.args, { p_event_id: 'evt-1', p_rating: 5, p_body: 'Great night' });
});

test('submitReview maps a tagged error', async () => {
  const sb = sbWith(() => ({ data: { error: 'not_attended' }, error: null }));
  const res = await submitReview(sb, 'evt-1', 4, '');
  assert.deepEqual(res, { error: 'not_attended' });
});

test('submitReview throws on a transport error', async () => {
  const sb = sbWith(() => ({ data: null, error: { message: 'boom' } }));
  await assert.rejects(() => submitReview(sb, 'evt-1', 4, ''), /boom/);
});

test('listReviews returns the rows', async () => {
  const rows = [{ id: 1, rating: 5, eventTitle: 'X', username: 'u', body: 'nice' }];
  const sb = sbWith((name) => { assert.equal(name, 'get_reviews'); return { data: rows, error: null }; });
  assert.deepEqual(await listReviews(sb), rows);
});

test('listReviewableEvents returns the rows', async () => {
  const rows = [{ id: 'evt-1', title: 'X' }];
  const sb = sbWith((name) => { assert.equal(name, 'get_my_reviewable_events'); return { data: rows, error: null }; });
  assert.deepEqual(await listReviewableEvents(sb), rows);
});
