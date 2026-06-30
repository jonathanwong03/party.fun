import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Sparkles, Check, Trash2, Plus, History, ArrowLeft } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  sendChat, fetchAiModels, executeAiAction,
  fetchConversations, fetchConversation, deleteConversation,
  type ChatMessage, type AiModel, type AgentProposal, type AiConversation,
} from '../api';

type Turn = ChatMessage & { via?: string; proposals?: AgentProposal[] };
type ActionState = { status: 'idle' | 'busy' | 'done' | 'error'; message?: string };

// Floating AI agent: a launcher + chat panel. The model calls backend tools in a
// loop; a dropdown picks the provider/model. Conversations are saved per user —
// "New chat" starts a thread, the history list reopens past ones.
export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [messages, setMessages] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<AiModel[]>([]);
  const [picked, setPicked] = useState('auto'); // 'auto' = router chooses; else `${provider}|${model}`
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Pending (un-acted) proposals from the most recent assistant message that has any.
  function pendingProposals(): AgentProposal[] {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const ps = messages[i].proposals ?? [];
      if (ps.length === 0) continue;
      return ps.filter((p) => (actions[p.id]?.status ?? 'idle') === 'idle');
    }
    return [];
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;

    // Typing "confirm" applies the pending proposal instead of messaging the model.
    if (/^confirm$/i.test(text)) {
      const pending = pendingProposals();
      if (pending.length > 0) {
        setInput('');
        for (const p of pending) await confirmAction(p);
        return;
      }
    }

    const next: Turn[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const [provider, model] = picked && picked !== 'auto' ? picked.split('|') : [];
      const res = await sendChat(
        next.map(({ role, content }) => ({ role, content })),
        provider && model ? { provider, model } : undefined,
        conversationId,
      );
      if (!res.available) { setHidden(true); return; }
      if (res.conversationId) setConversationId(res.conversationId);
      const via = res.model ? `${res.provider} · ${res.model}` : undefined;
      setMessages([...next, { role: 'assistant', content: res.reply ?? 'Sorry, I had trouble answering.', via, proposals: res.proposals }]);
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction(p: AgentProposal) {
    setActions((s) => ({ ...s, [p.id]: { status: 'busy' } }));
    try {
      const res = await executeAiAction(p.action, p.eventId, p.payload);
      const ok = res.status === 'ok';
      setActions((s) => ({ ...s, [p.id]: { status: ok ? 'done' : 'error', message: res.message } }));
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
      className="fixed bottom-6 right-6 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border shadow-2xl"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)', height: 520, maxHeight: 'calc(100vh - 3rem)' }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <span className="flex items-center gap-2" style={{ fontWeight: 700 }}>
          {view === 'history' ? (
            <button onClick={() => setView('chat')} className={iconBtn} style={muted} title="Back to chat"><ArrowLeft size={16} /></button>
          ) : (
            <Sparkles size={16} style={{ color: '#ff4d2e' }} />
          )}
          {view === 'history' ? 'Past conversations' : 'party.fun assistant'}
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
            </>
          )}
          <button onClick={() => setOpen(false)} className={iconBtn} style={muted}><X size={18} /></button>
        </div>
      </div>

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
                  {m.content}
                </div>
                {m.via && <div className="mt-0.5 px-1 text-[10px]" style={muted}>via {m.via}</div>}
                {(m.proposals ?? []).map((p) => {
                  const st = actions[p.id] ?? { status: 'idle' };
                  return (
                    <div key={p.id} className="mt-2 w-[90%] rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#ff4d2e' }}>
                        <Sparkles size={12} /> Action needs your confirmation
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
                          <button onClick={() => confirmAction(p)} disabled={st.status === 'busy'} className="rounded-lg px-3 py-1 text-xs font-semibold text-white transition disabled:opacity-50" style={{ background: '#ff4d2e' }}>
                            {st.status === 'busy' ? 'Applying…' : 'Confirm'}
                          </button>
                          <button onClick={() => setActions((s) => ({ ...s, [p.id]: { status: 'done', message: 'Dismissed.' } }))} disabled={st.status === 'busy'} className="rounded-lg px-3 py-1 text-xs transition disabled:opacity-50" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}>
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

          <div className="flex items-center gap-2 border-t p-3" style={{ borderColor: 'var(--border)' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="Ask anything…"
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
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
