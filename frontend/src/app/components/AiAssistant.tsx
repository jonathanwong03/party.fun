import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Sparkles, Check, Trash2, Plus, History, ArrowLeft, Brain } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  sendChat, resumeChat, fetchAiModels,
  fetchConversations, fetchConversation, deleteConversation,
  fetchMemories, deleteMemory, clearMemories,
  type ChatMessage, type AiModel, type AgentProposal, type AiConversation, type AiMemory,
} from '../api';

type Turn = ChatMessage & { via?: string; proposals?: AgentProposal[]; threadId?: string };
type ActionState = { status: 'idle' | 'busy' | 'done' | 'error'; message?: string };

// Per-action confirmation-card label; `danger` tints money/irreversible actions.
const ACTION_META: Record<string, { label: string; danger?: boolean }> = {
  update_event: { label: 'Edit event' },
  create_event_draft: { label: 'Create draft' },
  invite_coorganiser: { label: 'Invite co-organiser' },
  topup: { label: 'Wallet top-up', danger: true },
  pledge: { label: 'Buy tickets (wallet)', danger: true },
  cancel_event: { label: 'Cancel event & refund', danger: true },
  delete_draft: { label: 'Delete draft', danger: true },
};
const actionMeta = (action: string) => ACTION_META[action] ?? { label: 'Action needs your confirmation' };

// Render an assistant reply as clean plain-text paragraphs: strip markdown syntax
// (bold/headings/code/bullets) and split into paragraphs so replies aren't a wall of text.
function renderReply(content: string): string[] {
  const cleaned = content
    .replace(/\*\*(.*?)\*\*/g, '$1')   // **bold**
    .replace(/__(.*?)__/g, '$1')       // __bold__
    .replace(/`([^`]+)`/g, '$1')       // `code`
    .replace(/^#{1,6}\s*/gm, '')       // # headings
    .replace(/^\s*[-*]\s+/gm, '')      // - / * bullet markers
    .replace(/\*/g, '');               // stray asterisks
  return cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

// Floating AI agent: a launcher + chat panel. The model calls backend tools in a
// loop; a dropdown picks the provider/model. Conversations are saved per user —
// "New chat" starts a thread, the history list reopens past ones. `onDataChanged`
// refreshes the app's data after a write so edits show instantly.
export function AiAssistant({ onDataChanged }: { onDataChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [view, setView] = useState<'chat' | 'history' | 'memory'>('chat');
  const [messages, setMessages] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [memories, setMemories] = useState<AiMemory[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<AiModel[]>([]);
  const [picked, setPicked] = useState('auto'); // 'auto' = router chooses; else `${provider}|${model}`
  const [mode, setMode] = useState<'ask' | 'auto'>('ask'); // ask = confirm each write; auto = apply immediately
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // null = anchored bottom-right
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Drag the panel by its header; clamp to the viewport.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragRef.current) return;
      const w = panelRef.current?.offsetWidth ?? 400;
      const h = panelRef.current?.offsetHeight ?? 640;
      const x = Math.min(Math.max(0, e.clientX - dragRef.current.dx), window.innerWidth - w);
      const y = Math.min(Math.max(0, e.clientY - dragRef.current.dy), window.innerHeight - h);
      setPos({ x, y });
    }
    function onUp() { dragRef.current = null; }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, []);

  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button, [role="combobox"]')) return; // don't hijack header controls
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setPos({ x: rect.left, y: rect.top });
    e.preventDefault();
  }

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    fetchAiModels()
      .then((r) => { if (!ignore) { if (!r.available) setHidden(true); else setModels(r.models ?? []); } })
      .catch(() => {});
    return () => { ignore = true; };
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  function newChat() {
    setMessages([]);
    setConversationId(null);
    setActions({});
    setView('chat');
  }

  async function openHistory() {
    setView('history');
    try {
      const r = await fetchConversations();
      setConversations(r.conversations ?? []);
    } catch { setConversations([]); }
  }

  async function loadConversation(id: string) {
    try {
      const r = await fetchConversation(id);
      setMessages((r.messages ?? []).map((m) => ({ role: m.role, content: m.content, via: m.model || undefined })));
      setConversationId(id);
      setActions({});
      setView('chat');
    } catch { /* ignore */ }
  }

  async function removeConversation(id: string) {
    try { await deleteConversation(id); } catch { /* ignore */ }
    setConversations((c) => c.filter((x) => x.id !== id));
    if (id === conversationId) newChat();
  }

  async function openMemory() {
    setView('memory');
    try { const r = await fetchMemories(); setMemories(r.memories ?? []); } catch { setMemories([]); }
  }
  async function forget(id: number) {
    try { await deleteMemory(id); } catch { /* ignore */ }
    setMemories((m) => m.filter((x) => x.id !== id));
  }
  async function forgetAll() {
    try { await clearMemories(); } catch { /* ignore */ }
    setMemories([]);
  }

  const pickedModel = () => {
    const [provider, model] = picked && picked !== 'auto' ? picked.split('|') : [];
    return provider && model ? { provider, model } : undefined;
  };

  // Pending (un-acted) proposals from the most recent assistant message that has any,
  // together with that message's graph threadId (needed to resume/confirm them).
  function pendingWithThread(): { threadId?: string; proposals: AgentProposal[] } {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const ps = messages[i].proposals ?? [];
      if (ps.length === 0) continue;
      return { threadId: messages[i].threadId, proposals: ps.filter((p) => (actions[p.id]?.status ?? 'idle') === 'idle') };
    }
    return { proposals: [] };
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;

    // Typing "confirm" applies the pending proposal(s) instead of messaging the model.
    if (/^confirm$/i.test(text)) {
      const { threadId, proposals } = pendingWithThread();
      if (proposals.length > 0) {
        setInput('');
        for (const p of proposals) await decideAction(p, threadId, 'confirm');
        return;
      }
    }

    const next: Turn[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      // Auto mode: the graph executes writes inline (no confirmation round-trip).
      const res = await sendChat(
        next.map(({ role, content }) => ({ role, content })),
        pickedModel(),
        conversationId,
        mode,
      );
      if (!res.available) { setHidden(true); return; }
      if (res.conversationId) setConversationId(res.conversationId);
      const via = res.model ? `${res.provider} · ${res.model}` : undefined;
      // In auto mode writes already ran — don't render confirmation cards; just refresh.
      const proposals = mode === 'auto' ? [] : res.proposals;
      setMessages([...next, { role: 'assistant', content: res.reply ?? 'Sorry, I had trouble answering.', via, proposals, threadId: res.threadId }]);
      if (res.results?.length) onDataChanged?.();
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  // Confirm or reject one proposal by resuming its parked graph thread.
  async function decideAction(p: AgentProposal, threadId: string | undefined, decision: 'confirm' | 'reject') {
    if (!threadId) { setActions((s) => ({ ...s, [p.id]: { status: 'error', message: 'This proposal has expired — please ask again.' } })); return; }
    setActions((s) => ({ ...s, [p.id]: { status: 'busy' } }));
    try {
      const res = await resumeChat(threadId, p.id, decision, conversationId, pickedModel());
      if (res.conversationId) setConversationId(res.conversationId);
      if (decision === 'reject') {
        setActions((s) => ({ ...s, [p.id]: { status: 'done', message: 'Dismissed.' } }));
        return;
      }
      const outcome = (res.results ?? []).find((r) => r.proposalId === p.id);
      const ok = outcome ? outcome.ok : true;
      setActions((s) => ({ ...s, [p.id]: { status: ok ? 'done' : 'error', message: outcome?.message ?? res.reply } }));
      if (ok) onDataChanged?.(); // refresh app data so the change shows instantly
    } catch (e) {
      setActions((s) => ({ ...s, [p.id]: { status: 'error', message: e instanceof Error ? e.message : 'Action failed.' } }));
    }
  }

  if (hidden) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Ask the party.fun assistant"
        className="fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full text-white shadow-lg transition hover:scale-105"
        style={{ background: '#ff4d2e' }}
      >
        <MessageCircle size={24} />
      </button>
    );
  }

  const iconBtn = 'rounded-md p-1 transition hover:bg-white/5';
  const muted = { color: 'var(--muted-foreground)' } as const;

  return (
    <div
      ref={panelRef}
      className={`fixed z-50 flex w-[400px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border shadow-2xl ${pos ? '' : 'bottom-6 right-6'}`}
      style={{ borderColor: 'var(--border)', background: 'var(--surface)', height: 640, maxHeight: 'calc(100vh - 3rem)', ...(pos ? { left: pos.x, top: pos.y } : {}) }}
    >
      <div onPointerDown={startDrag} className="flex cursor-move select-none items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <span className="flex items-center gap-2" style={{ fontWeight: 700 }}>
          {view !== 'chat' ? (
            <button onClick={() => setView('chat')} className={iconBtn} style={muted} title="Back to chat"><ArrowLeft size={16} /></button>
          ) : (
            <Sparkles size={16} style={{ color: '#ff4d2e' }} />
          )}
          {view === 'history' ? 'Past conversations' : view === 'memory' ? 'What I remember' : 'party.fun assistant'}
        </span>
        <div className="flex items-center gap-1.5">
          {view === 'chat' && (
            <>
              {models.length > 0 && (
                <Select value={picked} onValueChange={setPicked}>
                  <SelectTrigger size="sm" className="text-xs" style={{ background: 'var(--surface)', maxWidth: 140 }}>
                    <SelectValue placeholder="Auto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    {models.map((m) => (
                      <SelectItem key={`${m.provider}|${m.model}`} value={`${m.provider}|${m.model}`}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <button onClick={newChat} title="New chat" className={iconBtn} style={muted}><Plus size={17} /></button>
              <button onClick={openHistory} title="Past conversations" className={iconBtn} style={muted}><History size={16} /></button>
              <button onClick={openMemory} title="What I remember about you" className={iconBtn} style={muted}><Brain size={16} /></button>
            </>
          )}
          {view === 'memory' && memories.length > 0 && (
            <button onClick={forgetAll} title="Forget everything" className="rounded-md px-2 py-1 text-xs transition hover:bg-white/5" style={muted}>Clear all</button>
          )}
          <button onClick={() => setOpen(false)} className={iconBtn} style={muted}><X size={18} /></button>
        </div>
      </div>

      {view === 'chat' && (
        <div className="flex items-center gap-2 border-b px-4 py-2 text-xs" style={{ borderColor: 'var(--border)' }}>
          <span style={muted}>Mode</span>
          <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--surface-2)' }}>
            {(['ask', 'auto'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="rounded-md px-2 py-0.5 transition"
                style={{ background: mode === m ? '#ff4d2e' : 'transparent', color: mode === m ? '#fff' : 'var(--muted-foreground)', fontWeight: 600 }}
                title={m === 'ask' ? 'Ask for permission before each change' : 'Apply changes immediately'}
              >
                {m === 'ask' ? 'Ask permission' : 'Auto-edit'}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'history' ? (
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {conversations.length === 0 ? (
            <div className="grid h-full place-items-center px-4 text-center text-sm" style={muted}>No saved conversations yet.</div>
          ) : conversations.map((c) => (
            <div key={c.id} className="group flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-white/5">
              <button onClick={() => loadConversation(c.id)} className="flex-1 truncate text-left text-sm" style={{ color: 'var(--foreground)' }}>
                {c.title}
                <span className="block text-[10px]" style={muted}>{new Date(c.updatedAt).toLocaleString()}</span>
              </button>
              <button onClick={() => removeConversation(c.id)} title="Delete" className={iconBtn} style={muted}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      ) : view === 'memory' ? (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {memories.length === 0 ? (
            <div className="grid h-full place-items-center px-4 text-center text-sm" style={muted}>
              Nothing remembered yet. Tell me your interests, budget or preferences and I'll adapt over time.
            </div>
          ) : memories.map((m) => (
            <div key={m.id} className="group flex items-start gap-2 rounded-lg px-2 py-2 transition hover:bg-white/5">
              <span className="flex-1 text-sm" style={{ color: 'var(--foreground)' }}>
                {m.content}
                {m.category && <span className="ml-1 text-[10px] uppercase" style={muted}>· {m.category}</span>}
              </span>
              <button onClick={() => forget(m.id)} title="Forget this" className={iconBtn} style={muted}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="text-sm" style={muted}>
                Hi! I can look up real events, check your forecasts, and help plan an event. Ask away.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start'}>
                <div
                  className="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
                  style={m.role === 'user' ? { background: '#ff4d2e', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--foreground)' }}
                >
                  {m.role === 'assistant' ? (
                    <div className="space-y-2">{renderReply(m.content).map((para, j) => <p key={j}>{para}</p>)}</div>
                  ) : (
                    m.content
                  )}
                </div>
                {m.via && <div className="mt-0.5 px-1 text-[10px]" style={muted}>via {m.via}</div>}
                {(m.proposals ?? []).map((p) => {
                  const st = actions[p.id] ?? { status: 'idle' };
                  const meta = actionMeta(p.action);
                  return (
                    <div key={p.id} className="mt-2 w-[90%] rounded-xl p-3" style={{ background: 'var(--surface-2)', border: `1px solid ${meta.danger ? '#ff4d2e' : 'var(--border)'}` }}>
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#ff4d2e' }}>
                        <Sparkles size={12} /> {meta.label} · needs confirmation
                      </div>
                      <div className="mt-1 text-sm" style={{ color: 'var(--foreground)' }}>{p.summary}</div>
                      {st.status === 'done' ? (
                        <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: '#29e07a' }}>
                          <Check size={14} /> {st.message ?? 'Done.'}
                        </div>
                      ) : st.status === 'error' ? (
                        <div className="mt-2 text-xs" style={{ color: '#ff4d2e' }}>{st.message ?? 'Action failed.'}</div>
                      ) : (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => decideAction(p, m.threadId, 'confirm')} disabled={st.status === 'busy'} className="rounded-lg px-3 py-1 text-xs font-semibold text-white transition disabled:opacity-50" style={{ background: '#ff4d2e' }}>
                            {st.status === 'busy' ? 'Applying…' : 'Confirm'}
                          </button>
                          <button onClick={() => decideAction(p, m.threadId, 'reject')} disabled={st.status === 'busy'} className="rounded-lg px-3 py-1 text-xs transition disabled:opacity-50" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}>
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {busy && <div className="text-xs" style={muted}>Thinking…</div>}
          </div>

          <div className="flex items-end gap-2 border-t p-3" style={{ borderColor: 'var(--border)' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="Ask anything…  (Shift+Enter for a new line)"
              rows={2}
              className="max-h-32 flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
            <button onClick={submit} disabled={busy || !input.trim()} className="flex size-9 items-center justify-center rounded-lg text-white transition disabled:opacity-40" style={{ background: '#ff4d2e' }}>
              <Send size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
