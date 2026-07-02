// Per-user agent memory: durable preferences the agent learns and reads back to
// personalise. Reads/writes are scoped to one user — the chat passes the caller's
// RLS client; the advisor passes the service-role client + an explicit userId.

const CAP = 40;

export async function loadMemory(sb, userId) {
  let q = sb.from('AI_USER_MEMORY').select('id, content, category, created_at').order('created_at', { ascending: false }).limit(CAP);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) { console.warn('[ai memory] load failed:', error.message); return []; }
  return (data ?? []).map((m) => ({ id: m.id, content: m.content, category: m.category }));
}

// Save a learned fact. Explicitly sets user_id (the advisor's service client has no
// auth.uid()). De-dupes on identical content and prunes to the newest CAP rows.
export async function rememberFact(sb, userId, { content, category }) {
  const text = String(content ?? '').trim();
  if (!text) return { skipped: true };

  const existing = await loadMemory(sb, userId);
  if (existing.some((m) => m.content.toLowerCase() === text.toLowerCase())) return { duplicate: true };

  const { error } = await sb.from('AI_USER_MEMORY').insert({ user_id: userId, content: text.slice(0, 300), category: category ?? null });
  if (error) { console.warn('[ai memory] insert failed:', error.message); return { error: error.message }; }

  // Prune anything beyond the cap (oldest first).
  if (existing.length + 1 > CAP) {
    const overflow = existing.slice(CAP - 1).map((m) => m.id);
    if (overflow.length) await sb.from('AI_USER_MEMORY').delete().in('id', overflow);
  }
  return { status: 'ok' };
}

// Compact block for the system prompt (empty string when there's nothing yet).
export function formatMemory(rows) {
  if (!rows?.length) return '';
  const lines = rows.map((m) => `- ${m.content}${m.category ? ` (${m.category})` : ''}`).join('\n');
  return `What you remember about this user (use it to personalise your help):\n${lines}`;
}
