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

test('runTier returns the first configured provider that succeeds', async () => {
  __setProvidersForTests({
    anthropic: mock({ text: 'from-anthropic' }),
    openai: mock({ text: 'from-openai' }),
    gemini: mock({ text: 'from-gemini' }),
  });
  const res = await runTier('cheap', { system: 's', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.text, 'from-anthropic');
});

test('runTier skips unconfigured providers', async () => {
  __setProvidersForTests({
    anthropic: mock({ configured: false }),
    openai: mock({ text: 'from-openai' }),
    gemini: mock({ configured: false }),
  });
  const res = await runTier('cheap', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.text, 'from-openai');
});

test('runTier falls through on error to the next provider', async () => {
  __setProvidersForTests({
    anthropic: mock({ throws: true }),
    openai: mock({ throws: true }),
    gemini: mock({ text: 'from-gemini' }),
  });
  const res = await runTier('premium', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.text, 'from-gemini');
});

test('runTier returns null when every provider fails or is unconfigured', async () => {
  __setProvidersForTests({
    anthropic: mock({ configured: false }),
    openai: mock({ throws: true }),
    gemini: mock({ throws: true }),
  });
  const res = await runTier('cheap', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res, null);
});

test('anyConfigured reflects whether any provider has a key', async () => {
  __setProvidersForTests({ anthropic: mock({ configured: false }), openai: mock({ configured: false }), gemini: mock({ configured: false }) });
  assert.equal(anyConfigured(), false);
  __setProvidersForTests({ anthropic: mock({ configured: true }), openai: mock({ configured: false }), gemini: mock({ configured: false }) });
  assert.equal(anyConfigured(), true);
});
