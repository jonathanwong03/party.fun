import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDoc, retrieveDocChunks, __resetDocIndexForTests } from './docKnowledge.js';
import { __setEmbedForTests, __resetEmbedForTests } from './embeddingService.js';

// A deterministic, offline "embedder": a bag-of-words vector over a fixed vocabulary. Cosine
// similarity then ranks the chunk that shares the most vocabulary with the query highest — the
// same directional behaviour as a real embedding model, but reproducible and network-free.
const VOCAB = ['signup', 'bonus', 'wallet', 'card', 'topup', 'refund', 'sign',
  'tiered', 'hype', 'pricing', 'price', 'event', 'ticket', 'draft', 'admin', 'weather'];
const countOf = (haystack, term) => haystack.split(term).length - 1;
const fakeEmbed = async (text) => {
  const lower = String(text).toLowerCase();
  return VOCAB.map((term) => countOf(lower, term));
};

test('chunkDoc splits app-knowledge.md into its "##" sections', () => {
  const md = '# Title\nintro para\n\n## Alpha\nalpha body\n\n## Beta\nbeta body';
  const chunks = chunkDoc(md);
  assert.equal(chunks.length, 3); // the intro, then Alpha, then Beta
  assert.match(chunks[1], /^## Alpha/);
  assert.match(chunks[2], /^## Beta/);
  assert.deepEqual(chunkDoc(''), []);
});

describe('retrieveDocChunks (in-memory RAG over the live doc)', () => {
  let savedKey;
  beforeEach(() => {
    savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key'; // makes isEmbeddingEnabled() true so retrieval runs
    __setEmbedForTests(fakeEmbed);
    __resetDocIndexForTests();
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    __resetEmbedForTests();
    __resetDocIndexForTests();
  });

  test('retrieves the accounts/wallet section for a signup-bonus question', async () => {
    const hit = await retrieveDocChunks('do new users get a $20 signup bonus in their wallet?', 1);
    assert.match(hit, /signup bonus/i);
    assert.match(hit, /\$20/);
  });

  test('ranks by the QUESTION — a pricing question returns pricing, not the signup section', async () => {
    // Mutation guard: if ranking ignored the query (e.g. always returned the first chunk), this
    // and the test above could not both pass.
    const hit = await retrieveDocChunks('how does hype-driven and tiered pricing work?', 1);
    assert.match(hit, /pricing/i);
    assert.doesNotMatch(hit, /signup bonus/i);
  });

  test('returns null when embeddings are unavailable (caller falls back to the whole doc)', async () => {
    delete process.env.GEMINI_API_KEY;
    __resetDocIndexForTests();
    const hit = await retrieveDocChunks('anything at all');
    assert.equal(hit, null);
  });
});
