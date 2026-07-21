# AI Agent Architecture (as built)

How the party.fun AI agent is actually implemented, and why. This document was originally a
forward-looking design proposal; it has been rewritten to describe the shipped system, with the
proposed-but-unbuilt ideas preserved at the end so the reasoning isn't lost.

For the agent's behavioural contract (what it must know and respect), see
[AGENT_AWARENESS.md](AGENT_AWARENESS.md). For the feature-level description, see
[APP_OVERVIEW.md → AI event-planning agent](APP_OVERVIEW.md#ai-event-planning-agent).

---

## 1. Core architecture: semi-autonomous (propose & confirm)

Rather than choosing between a pure read-only chatbot and a fully autonomous agent that executes
writes on its own, we use a **semi-autonomous hybrid**: the agent may read freely, but every write
is a *proposal* that a human must confirm.

### The shape of a write

1. **The chat input.** The user says *"Set up a birthday dinner draft for tomorrow at 7 PM."*
2. **The tool call.** The model calls a `propose_*` tool — never a write tool. There are nine:
   `propose_create_event`, `propose_update_event`, `propose_edit_draft`, `propose_delete_draft`,
   `propose_cancel_event`, `propose_invite_coorganiser`, `propose_pledge`, `propose_topup`,
   `propose_give_away_tickets`.
3. **The graph pauses.** The proposal tool triggers a LangGraph `interrupt()` — a real
   human-in-the-loop pause, not a convention. The response carries the proposal(s) plus a
   `threadId` identifying the parked graph state.
4. **The proposal card.** The frontend renders each proposal as a card in the chat thread
   ([AiAssistant.tsx](frontend/src/app/components/AiAssistant.tsx)). Cards are **read-only
   summaries with Confirm / Dismiss** — the user does not edit fields in the card; to change
   something they say so in chat and the agent proposes again. Money and irreversible actions are
   tinted `danger`.
5. **Resume.** Confirming calls `POST /api/ai/chat/resume` with the `threadId`, the proposal id and
   `'confirm' | 'reject'`, which resumes the parked graph. Typing "confirm" in the composer does
   the same thing.
6. **Execution re-validates from scratch.** `executeAction`
   ([backend/services/ai/agent/actions.js](backend/services/ai/agent/actions.js)) re-checks
   ownership and balances through the **caller's own RLS-scoped Supabase client** and reuses the
   same services the normal UI uses. Graph state is never trusted for money.

### The graph

Chat runs as one explicit `StateGraph`
([backend/services/ai/agent/eventGraph.js](backend/services/ai/agent/eventGraph.js)):

```text
scope → classify → role_gate → { answer | discover | bestfit | manage | transact | auto_draft }
                                        ↓ (if proposals)
                                     confirm  ← interrupt()
                                        ↓
                                     execute → END
```

with three refusal exits: `refuse` (off-topic), `role_refuse` (a user attempting an organiser
action) and `admin_create_refuse` (an admin attempting to host).

- **`scope`** rejects off-topic questions before any tool runs.
- **`classify`** tags intent and routes to a branch. It reads the last few turns, not just the
  latest message, so short follow-ups ("yes, whatever you think") keep their intent.
- **`role_gate`** enforces role rules deterministically rather than trusting the model.
- **Each branch is its own `createAgent`** (LangChain v1, built on LangGraph) with a **scoped
  toolset**, so a discovery branch structurally cannot move money. A small set of personal reads is
  bound into *every* branch so a misrouted question never produces a false "I can't do that".

**Checkpointer caveat:** the `MemorySaver` is in-process. Pending confirmations are lost on a
backend restart and do not span instances. This is acceptable only because `execute` re-validates
everything — a lost confirmation means the user re-asks, never that something unsafe runs. Scaling
the backend past one instance requires either sticky sessions or moving the checkpointer to
Redis/Postgres.

---

## 2. Why an AI is needed at all

If the final action is a database write, why involve a model?

- **Intent extraction & parameterisation.** Users don't write database records. They type *"I want
  to do a gathering this Friday night at NTU, maybe call it North Spine Social, base price 10 max
  20 capacity 50."* The model parses that into schema fields and resolves relative dates ("this
  Friday" → an ISO timestamp in Singapore time, injected fresh each turn).
- **Context-aware recommendations.** It cross-references the request against past events, pricing
  models and researched student trends before proposing — e.g. recommending tiered vs hype pricing
  and a sensible hype threshold for the stated capacity.
- **Conversational flow → structured actions.** It bridges natural language and rigid forms,
  removing the need to learn the Create Event UI.

---

## 3. Cost control (as built)

Three mechanisms keep token spend down. Note these differ from what was originally proposed —
see §5.

### A. Fixed-window history

Context is trimmed with **fixed slice windows** rather than summarisation: the classifier reads
`slice(-6)`, app-question answering reads `slice(-6)`, and general chat reads `slice(-12)`. Simple,
predictable, and no extra model call per turn.

### B. Scoped toolsets per branch

Because `classify` routes to a branch that only carries the tools it needs, the tool definitions
sent to the model are a fraction of the full 28-tool surface on any given turn. This is both a cost
control and a safety property.

### C. Deterministic short-circuits

High-frequency asks are answered **in code, before the graph runs at all**
([listReplies.js](backend/services/ai/agent/listReplies.js)): the four plain list questions (events
I can join / joined / hosted / live across organisers), card linking, and named purchases where the
event name is resolved server-side so a typo can't become an invented event.

These were introduced for correctness as much as cost — the model mis-routed and mis-numbered
these questions. The rule that keeps them safe: **a short-circuit must only fire on the question it
can actually answer.** Anything *qualified* — a price cap, a quoted name, a superlative, a request
for one fact — must fall through to the model instead. Getting this boundary wrong is the recurring
bug in that file.

### D. Embedding cache

Gemini embeddings are cached in Redis for 24h keyed by `emb:<model>:<taskType>:<hash>`, so repeated
semantic searches never re-embed the same text.

---

## 4. Retrieval

Event search fuses two rankings via **Reciprocal Rank Fusion** (k=60) in `match_events_hybrid`:
Gemini embeddings (`gemini-embedding-001`, 768-dim) in Supabase pgvector, and a Postgres `tsvector`
generated column. Pure vector search is blind to proper nouns; pure keyword search is blind to
meaning. Degrades both ways — no embedding falls back to keyword-only, a missing RPC falls back to
vector-only.

The agent also retrieves over [app-knowledge.md](backend/services/ai/app-knowledge.md) (its own
description of the app), a per-user memory store (`AI_USER_MEMORY`, written via the `remember`
tool), and past chat messages.

---

## 5. Proposed but not implemented

Recorded so the reasoning survives; **none of this exists in the codebase.**

- **Rolling history summarisation.** The original proposal was to keep the last 5 turns raw and
  compress everything older into an LLM-generated paragraph. Not built — fixed slice windows (§3A)
  proved sufficient at current conversation lengths, and summarisation costs a model call per turn
  to save tokens on a history that rarely grows that long. (Note: `summarize()` in `eventGraph.js`
  summarises **tool results**, not chat history — it is not this feature.)
- **Token telemetry middleware.** Logging input/output/cache token counts per request was planned
  for Phase 3. Not built — there is no `usageMetadata`/`tokenCount` instrumentation anywhere in
  `backend/services/ai/`. Worth adding if cost ever needs attribution per user or per branch.
- **Client-side tool filtering.** The proposal put a regex classifier in the browser to skip
  action-agent tools for informational queries. This landed **server-side** instead, as the `scope`
  guard plus `classify` routing plus the short-circuits in §3C — a client-side gate would have been
  trivially bypassable and would have duplicated logic the server needs anyway.
- **Editable proposal cards.** The proposal had users adjusting values inside the card before
  confirming. Shipped as confirm/reject only; corrections happen conversationally. This keeps a
  single validation path (the model proposes, the server validates) rather than two.
- **`propose_ticket_purchase`.** Named `propose_pledge` in the implementation, matching the domain
  glossary in [APP_OVERVIEW.md](APP_OVERVIEW.md#concepts--glossary) where a purchase is a *pledge*.
