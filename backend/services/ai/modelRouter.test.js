import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  runTier,
  anyConfigured,
  __setProvidersForTests,
  __resetProvidersForTests,
} from './modelRouter.js';

afterEach(() => __resetProvidersForTests());

function mock({ configured = true, text = '{"ok":true}', throws = false } = {}) {
  return {
    isConfigured: () => configured,
    generate: async ({ model }) => {
      if (throws) throw new Error('boom');
      return { text, provider: 'mock', model };
    },
  };
}

test('runTier returns the Gemini provider result', async () => {
  __setProvidersForTests({ gemini: mock({ text: 'from-gemini' }) });
  const res = await runTier('cheap', { system: 's', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.text, 'from-gemini');
});

test('runTier skips the provider when it is unconfigured', async () => {
  __setProvidersForTests({ gemini: mock({ configured: false }) });
  const res = await runTier('cheap', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res, null);
});

test('runTier returns null when the provider errors', async () => {
  __setProvidersForTests({ gemini: mock({ throws: true }) });
  const res = await runTier('premium', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res, null);
});

test('anyConfigured reflects whether Gemini has a key', async () => {
  __setProvidersForTests({ gemini: mock({ configured: false }) });
  assert.equal(anyConfigured(), false);
  __setProvidersForTests({ gemini: mock({ configured: true }) });
  assert.equal(anyConfigured(), true);
});
