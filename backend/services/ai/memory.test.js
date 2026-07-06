import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRelevantMemory } from './memory.js';

// Memory chain mock: .select().order().limit().eq() → rows.
const mockSb = (rows) => ({
  from: () => ({ select: () => ({ order: () => ({ limit: () => ({ eq: async () => ({ data: rows, error: null }) }) }) }) }),
});

test('loadRelevantMemory falls back to loadMemory (all rows) when embeddings are off', async () => {
  delete process.env.GEMINI_API_KEY; // embeddings unavailable
  const rows = [{ id: 1, content: 'Loves gaming', category: 'interest', created_at: '2026-07-01' }];
  const out = await loadRelevantMemory(mockSb(rows), 'u1', 'what events suit me?');
  assert.equal(out.length, 1);
  assert.equal(out[0].content, 'Loves gaming');
});
