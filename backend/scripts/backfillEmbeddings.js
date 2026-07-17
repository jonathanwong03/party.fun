// One-off backfill: embed every existing event (+ memories, chat, drafts).
// Run once (and after bulk data changes):  node scripts/backfillEmbeddings.js
// NB: app-knowledge.md is NOT embedded — the live file is the single source of truth, read
// directly by the graph agent's system prompt, the get_app_info tool and answerAppQuestion.
import 'dotenv/config';
import { adminClient } from '../services/supabaseAdmin.js';
import { embedText, toVectorLiteral, isEmbeddingEnabled } from '../services/ai/embeddingService.js';
import { eventEmbeddingText, eventEmbeddingHash } from '../services/ai/eventEmbeddings.js';
import { embedMemory } from '../services/ai/memory.js';
import { embedChatMessage } from '../services/ai/chatHistory.js';
import { syncDraftEmbedding } from '../services/ai/draftEmbeddings.js';

async function backfillEvents(admin) {
  const { data: rows, error } = await admin.rpc('get_events');
  if (error) throw new Error(`get_events: ${error.message}`);
  const { data: existing } = await admin.from('EVENT_EMBEDDINGS').select('event_id, source_hash');
  const hashById = new Map((existing ?? []).map((r) => [r.event_id, r.source_hash]));
  let done = 0;
  for (const e of rows ?? []) {
    const ev = { title: e.title, description: e.description, location: e.location, address: e.address };
    const text = eventEmbeddingText(ev);
    if (!text) continue;
    const hash = eventEmbeddingHash(ev);
    if (hashById.get(e.id) === hash) continue; // unchanged since last run
    const vec = await embedText(text, { taskType: 'RETRIEVAL_DOCUMENT' });
    if (!vec) { console.warn(`skip (no vector): ${e.title}`); continue; }
    const { error: upErr } = await admin.rpc('upsert_event_embedding', {
      p_event_id: e.id, p_embedding: toVectorLiteral(vec), p_hash: hash,
    });
    if (upErr) { console.warn(`upsert failed for ${e.title}: ${upErr.message}`); continue; }
    done += 1;
    console.log(`embedded event: ${e.title}`);
  }
  console.log(`Events embedded/updated: ${done}`);
}

async function backfillMemories(admin) {
  const { data: rows } = await admin.from('AI_USER_MEMORY').select('id, content, embedding');
  let done = 0;
  for (const m of rows ?? []) {
    if (m.embedding) continue; // already embedded
    await embedMemory(admin, m.id, m.content);
    done += 1;
  }
  console.log(`Memories embedded: ${done}`);
}

async function backfillChatMessages(admin) {
  const { data: rows } = await admin.from('AI_CHAT_MESSAGES').select('id, content, embedding');
  let done = 0;
  for (const m of rows ?? []) {
    if (m.embedding || !m.content) continue;
    await embedChatMessage(admin, m.id, m.content);
    done += 1;
  }
  console.log(`Chat messages embedded: ${done}`);
}

async function backfillDrafts(admin) {
  const { data: rows } = await admin.from('EVENT_DRAFTS').select('id, userId, payload');
  let done = 0;
  for (const d of rows ?? []) {
    if (!d.id || !d.userId) continue;
    await syncDraftEmbedding(admin, d.id, d.userId, { id: d.id, ...(d.payload ?? {}) });
    done += 1;
  }
  console.log(`Drafts checked for embeddings: ${done}`);
}

async function main() {
  if (!isEmbeddingEnabled()) { console.error('GEMINI_API_KEY not set — cannot embed.'); process.exit(1); }
  const admin = adminClient();
  await backfillEvents(admin);
  await backfillMemories(admin);
  await backfillChatMessages(admin);
  await backfillDrafts(admin);
  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
