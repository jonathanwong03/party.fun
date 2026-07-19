import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from './timeout.js';

test('withTimeout resolves when the promise settles before the deadline', async () => {
  const val = await withTimeout(Promise.resolve('ok'), 1000, 'fast');
  assert.equal(val, 'ok');
});

test('withTimeout rejects when the promise is too slow', async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 50));
  await assert.rejects(withTimeout(slow, 5, 'slow'), /slow timed out after 5ms/);
});

test('withTimeout propagates the underlying rejection', async () => {
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 1000, 'x'), /boom/);
});
