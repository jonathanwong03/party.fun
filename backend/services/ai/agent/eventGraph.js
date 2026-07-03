import { randomUUID } from 'crypto';
import { StateGraph, Annotation, MessagesAnnotation, MemorySaver, Command, interrupt, START, END } from '@langchain/langgraph';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createAgent } from 'langchain';
import { resolveCandidates, runTier } from '../modelRouter.js';
import { TOOLS_BY_NAME } from './tools.js';
import { executeAction } from './actions.js';

// ── LangGraph event-planning agent (full workflow) ───────────────────────────
// The whole diagram is one graph:
//
//   START → classify →(intent)→ { answer | discover | bestfit | manage | transact }
//                                       each branch = a createAgent agent
//                                       ↓ (if it produced write proposals)
//                     ask:  confirm(interrupt) → execute → (more? loop) → END
//                     auto: execute → END
//                     advisor(autonomous): END   (proposals are advisory only)
//
// Each branch is a canonical LangChain v1 `createAgent(...)` (built on LangGraph) —
// a single named agent with a SCOPED toolset. The confirm step is a real
// human-in-the-loop `interrupt()` persisted by a checkpointer; the execute step
// calls the existing `executeAction` (re-validates ownership/balances via RLS), so
// "execute in the graph" never trusts graph state for money.

const RECURSION_LIMIT = 25;

// One in-process checkpointer holds paused threads (pending confirmations) between
// the propose request and the confirm/resume request. In-memory: lost on restart /
// single-instance — acceptable because execute re-validates and a lost pending
// confirmation just means the user re-asks.
const CHECKPOINTER = new MemorySaver();

// The tools (idiomatic `tool()` + zod definitions) live in tools.js; bind the
// scoped subset for each branch by name.
const pickTools = (names) => names.map((n) => TOOLS_BY_NAME[n]).filter(Boolean);

// Per-branch scoped toolsets (the only structural difference between branches).
export const BRANCH_TOOLS = {
  read_only: ['search_events', 'list_available_events', 'get_event_details', 'get_event_forecast', 'get_my_hosted_events', 'get_my_joined_events', 'get_wallet', 'list_my_drafts', 'remember'],
  discovery: ['search_events', 'list_available_events', 'get_event_details', 'remember'],
  best_fit: ['list_available_events', 'search_events', 'get_my_joined_events', 'get_event_details', 'remember'],
  event_mgmt: ['get_my_hosted_events', 'get_event_details', 'list_my_drafts', 'get_event_forecast', 'propose_update_event', 'propose_create_event', 'propose_invite_coorganiser', 'propose_cancel_event', 'propose_delete_draft', 'remember'],
  transaction: ['get_wallet', 'list_available_events', 'get_my_hosted_events', 'get_event_details', 'propose_topup', 'propose_pledge', 'propose_cancel_event', 'remember'],
};

const DIRECTIVES = {
  read_only: 'INTENT: read-only question. Answer using your read tools (events, wallet, forecast). Do not propose changes unless the user explicitly asks.',
  discovery: 'INTENT: event discovery. Use list_available_events / search_events and present a short, scannable list with prices.',
  best_fit: 'INTENT: best-fit / cheapest. Use list_available_events, then rank candidates by price, match to the stated interests, hype/popularity and date; recommend the best few and say why.',
  event_mgmt: "INTENT: manage the user's own events. Use the propose_* tools — every change is a proposal the user must confirm. To create, gather a title + start/end/deadline first. To DELETE a published event use propose_cancel_event (it refunds all backers); to delete a DRAFT use propose_delete_draft.",
  transaction: 'INTENT: wallet/money action. Check get_wallet first. Use propose_topup (add money to wallet), propose_pledge (buy tickets with wallet balance), or propose_cancel_event (refund backers by cancelling). Every money action is a proposal the user must confirm — never say money moved until they confirm.',
};

const INTENT_TO_NODE = { read_only: 'answer', discovery: 'discover', best_fit: 'bestfit', event_mgmt: 'manage', transaction: 'transact' };

// Regex fallback classifier (also the default when no cheap model is configured).
// Unit-tested directly.
export function classifyIntent(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return 'read_only';
  if (/\b(top\s?up|top-up|refund|deduct|wallet|balance|pay|purchase|buy|checkout|charge)\b/.test(t)) return 'transaction';
  if (/\b(cancel|delete|remove|edit|update|change|reschedule|rename|create|host|launch|draft|co-?organiser|coorganiser|invite|price|capacity|deadline)\b/.test(t)) return 'event_mgmt';
  if (/\b(cheapest|cheap|best|recommend|suggest|value|affordable|under\s*\$?\d|below\s*\$?\d|for me|interested)\b/.test(t)) return 'best_fit';
  if (/\b(find|search|show|list|browse|discover|whats on|what's on|events?\s+(near|around|happening))\b/.test(t)) return 'discovery';
  return 'read_only';
}

const INTENTS = ['read_only', 'discovery', 'best_fit', 'event_mgmt', 'transaction'];

// Default classify NODE logic: a cheap-tier LLM call, regex fallback on error/junk.
async function defaultClassify(text) {
  const t = String(text || '');
  if (!t.trim()) return 'read_only';
  try {
    const res = await runTier('cheap', {
      system: 'Classify the user request for an events app into EXACTLY one label. Reply with ONLY one of: read_only, discovery, best_fit, event_mgmt, transaction.',
      messages: [{ role: 'user', content: t }],
      maxTokens: 8,
    });
    const out = String(res?.text || '').toLowerCase();
    const hit = INTENTS.find((l) => out.includes(l));
    if (hit) return hit;
  } catch { /* fall through to regex */ }
  return classifyIntent(t);
}

// Default branch-agent builder: five canonical createAgent agents, one per intent.
function defaultBuildAgents(model, system) {
  const agents = {};
  for (const intent of INTENTS) {
    agents[intent] = createAgent({
      model,
      tools: pickTools(BRANCH_TOOLS[intent]),
      prompt: `${system}\n\n${DIRECTIVES[intent]}`,
    });
  }
  return agents;
}

// Model selection: reuse the router's preferred-first, configured-only ordering.
async function instantiate(provider, model, maxTokens) {
  if (provider === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({ model, apiKey: process.env.ANTHROPIC_API_KEY, maxTokens });
  }
  if (provider === 'openai') {
    const { ChatOpenAI } = await import('@langchain/openai');
    return new ChatOpenAI({ model, apiKey: process.env.OPENAI_API_KEY, maxTokens });
  }
  if (provider === 'gemini') {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    return new ChatGoogleGenerativeAI({ model, apiKey: process.env.GEMINI_API_KEY, maxOutputTokens: maxTokens });
  }
  return null;
}
async function defaultBuildModel(preferred, maxTokens) {
  const specs = resolveCandidates('premium', preferred);
  if (!specs.length) return null;
  const { provider, model } = specs[0];
  const chat = await instantiate(provider, model, maxTokens);
  if (!chat) return null;
  return { model: chat, provider, modelId: model };
}

// Test seams: swap in a fake model/agents/classifier without any API keys.
export const dependencies = { buildModel: defaultBuildModel, buildAgents: defaultBuildAgents, classify: defaultClassify };
export function __setBuildModelForTests(fn) { dependencies.buildModel = fn; }
export function __setAgentsForTests(fn) { dependencies.buildAgents = fn; }
export function __setClassifyForTests(fn) { dependencies.classify = fn; }
export function __resetGraphForTests() {
  dependencies.buildModel = defaultBuildModel;
  dependencies.buildAgents = defaultBuildAgents;
  dependencies.classify = defaultClassify;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('')
      : '';

function toLcMessage(m) {
  const content = String(m?.content ?? '');
  if (!content.trim()) return null;
  return m.role === 'assistant' ? new AIMessage(content) : new HumanMessage(content);
}

function lastAiText(messages) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?._getType?.() === 'ai') {
      const text = textOf(m.content);
      if (text.trim()) return text.trim();
    }
  }
  return "I gathered some info but couldn't finish — could you narrow that down?";
}

// Write proposals are surfaced by propose_* tools as { proposal } in their JSON result.
function parseProposals(messages) {
  const out = [];
  for (const m of messages ?? []) {
    if (m?._getType?.() !== 'tool') continue;
    try {
      const parsed = JSON.parse(typeof m.content === 'string' ? m.content : '');
      if (parsed && parsed.proposal) out.push(parsed.proposal);
    } catch { /* not a JSON tool result */ }
  }
  return out;
}

function summarize(results) {
  if (!results.length) return '';
  return results.map((r) => (r.ok ? `✅ ${r.message ?? 'Done.'}` : `⚠️ ${r.message ?? 'That action could not be completed.'}`)).join('\n');
}

// ── Graph state ──────────────────────────────────────────────────────────────
const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  intent: Annotation(),
  proposals: Annotation({ reducer: (a = [], b = []) => a.concat(b), default: () => [] }),
  decisions: Annotation({ reducer: (a = {}, b = {}) => ({ ...a, ...b }), default: () => ({}) }),
  results: Annotation({ reducer: (a = [], b = []) => a.concat(b), default: () => [] }),
});

const mode = (config) => config?.configurable?.mode ?? 'ask';

function buildApp(model, system) {
  const agents = dependencies.buildAgents(model, system);

  const classify = async (state, config) => {
    const lastUser = [...state.messages].reverse().find((m) => m?._getType?.() === 'human');
    return { intent: await dependencies.classify(textOf(lastUser?.content), config?.configurable?.ctx) };
  };

  const runBranch = (intent) => async (state, config) => {
    const res = await agents[intent].invoke({ messages: state.messages }, config);
    const newMsgs = (res.messages ?? []).slice(state.messages.length);
    return { messages: newMsgs, proposals: parseProposals(newMsgs) };
  };

  // Human-in-the-loop: pause and surface the still-undecided proposals; on resume,
  // record the {proposalId, decision} the user sent.
  const confirm = (state) => {
    const undecided = state.proposals.filter((p) => !(p.id in state.decisions));
    const resume = interrupt({ proposals: undecided });
    return resume?.proposalId ? { decisions: { [resume.proposalId]: resume.decision } } : {};
  };

  // Deterministic execution — always through executeAction (re-validates RLS/ownership/balances).
  const execute = async (state, config) => {
    const ctx = config?.configurable?.ctx;
    const user = { id: ctx?.userId, role: ctx?.role };
    const doneIds = new Set(state.results.map((r) => r.proposalId));
    const toRun = mode(config) === 'auto'
      ? state.proposals.filter((p) => !doneIds.has(p.id))
      : state.proposals.filter((p) => state.decisions[p.id] === 'confirm' && !doneIds.has(p.id));
    const results = [];
    for (const p of toRun) {
      const r = await executeAction({ sb: ctx.supabase, user, action: p.action, eventId: p.eventId, payload: p.payload });
      results.push({ proposalId: p.id, action: p.action, ok: !r?.error, message: r?.message ?? r?.error, status: r?.status });
    }
    const text = summarize(results);
    return { results, messages: text ? [new AIMessage(text)] : [] };
  };

  const routeIntent = (state) => INTENT_TO_NODE[state.intent] ?? 'answer';

  const afterBranch = (state, config) => {
    if (!state.proposals.length) return END;
    if (config?.configurable?.autonomous) return END; // advisor: proposals are advisory only
    return mode(config) === 'auto' ? 'execute' : 'confirm';
  };

  const afterExecute = (state, config) => {
    if (mode(config) === 'auto') return END;
    const undecided = state.proposals.filter((p) => !(p.id in state.decisions));
    return undecided.length ? 'confirm' : END;
  };

  const branchMap = { confirm: 'confirm', execute: 'execute', [END]: END };
  const graph = new StateGraph(GraphState)
    .addNode('classify', classify)
    .addNode('answer', runBranch('read_only'))
    .addNode('discover', runBranch('discovery'))
    .addNode('bestfit', runBranch('best_fit'))
    .addNode('manage', runBranch('event_mgmt'))
    .addNode('transact', runBranch('transaction'))
    .addNode('confirm', confirm)
    .addNode('execute', execute)
    .addEdge(START, 'classify')
    .addConditionalEdges('classify', routeIntent, { answer: 'answer', discover: 'discover', bestfit: 'bestfit', manage: 'manage', transact: 'transact' })
    .addConditionalEdges('answer', afterBranch, branchMap)
    .addConditionalEdges('discover', afterBranch, branchMap)
    .addConditionalEdges('bestfit', afterBranch, branchMap)
    .addConditionalEdges('manage', afterBranch, branchMap)
    .addConditionalEdges('transact', afterBranch, branchMap)
    .addEdge('confirm', 'execute')
    .addConditionalEdges('execute', afterExecute, { confirm: 'confirm', [END]: END });

  return graph.compile({ checkpointer: CHECKPOINTER });
}

function shape(state, interrupted, { threadId, provider, modelId }) {
  return {
    available: true,
    status: interrupted ? 'awaiting_confirmation' : 'done',
    reply: lastAiText(state?.messages),
    proposals: state?.proposals ?? [],
    results: state?.results ?? [],
    threadId,
    provider,
    model: modelId,
  };
}

// Start a run. `ctx` = { supabase, userId, role }; `mode` = 'ask'|'auto';
// `autonomous` = advisor (no interrupt). Returns { available, status, reply,
// proposals, results, threadId, provider, model }.
export async function runGraph({ system, messages, ctx, preferred, mode: runMode = 'ask', autonomous = false, threadId } = {}) {
  const built = await dependencies.buildModel(preferred, 1024);
  if (!built) return { available: false };
  const { model, provider, modelId } = built;

  const app = buildApp(model, system ?? '');
  const tid = threadId || randomUUID();
  const config = { configurable: { ctx, mode: runMode, autonomous, thread_id: tid }, recursionLimit: RECURSION_LIMIT };
  const input = { messages: (messages ?? []).map(toLcMessage).filter(Boolean) };

  try {
    await app.invoke(input, config);
  } catch (e) {
    console.warn('[eventGraph] run failed:', e?.message || e);
    return { available: true, status: 'done', reply: 'Sorry — I hit a snag working on that. Could you rephrase or try again?', proposals: [], results: [], threadId: tid, provider, model: modelId };
  }
  const snap = await app.getState(config);
  return shape(snap?.values, (snap?.next?.length ?? 0) > 0, { threadId: tid, provider, modelId });
}

// Resume a parked thread with the user's decision on one proposal (confirm/reject).
export async function resumeGraph({ system, ctx, preferred, threadId, proposalId, decision } = {}) {
  const built = await dependencies.buildModel(preferred, 1024);
  if (!built) return { available: false };
  const { model, provider, modelId } = built;

  const app = buildApp(model, system ?? '');
  const config = { configurable: { ctx, mode: 'ask', autonomous: false, thread_id: threadId }, recursionLimit: RECURSION_LIMIT };

  try {
    await app.invoke(new Command({ resume: { proposalId, decision } }), config);
  } catch (e) {
    console.warn('[eventGraph] resume failed:', e?.message || e);
    return { available: true, status: 'done', reply: 'Sorry — I could not apply that. Please try again.', proposals: [], results: [], threadId, provider, model: modelId };
  }
  const snap = await app.getState(config);
  return shape(snap?.values, (snap?.next?.length ?? 0) > 0, { threadId, provider, modelId });
}
