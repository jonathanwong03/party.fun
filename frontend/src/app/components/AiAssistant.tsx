import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { sendChat, fetchAiModels, type ChatMessage, type AiModel } from '../api';

type Turn = ChatMessage & { via?: string };

// Floating AI agent: a launcher button + chat panel. The model can call backend
// tools (search events, forecasts) in a loop. A dropdown lets the user pick which
// configured provider/model answers ("Auto" lets the router choose + fall back).
// Hides itself if no AI provider is configured.
export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<AiModel[]>([]);
  const [picked, setPicked] = useState('auto'); // 'auto' = router chooses; else `${provider}|${model}`
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

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Turn[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const [provider, model] = picked && picked !== 'auto' ? picked.split('|') : [];
      const res = await sendChat(
        next.map(({ role, content }) => ({ role, content })),
        provider && model ? { provider, model } : undefined,
      );
      if (!res.available) { setHidden(true); return; }
      const via = res.model ? `${res.provider} · ${res.model}` : undefined;
      setMessages([...next, { role: 'assistant', content: res.reply ?? 'Sorry, I had trouble answering.', via }]);
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setBusy(false);
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

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border shadow-2xl"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)', height: 520, maxHeight: 'calc(100vh - 3rem)' }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <span className="flex items-center gap-2" style={{ fontWeight: 700 }}>
          <Sparkles size={16} style={{ color: '#ff4d2e' }} /> party.fun assistant
        </span>
        <div className="flex items-center gap-2">
          {models.length > 0 && (
            <Select value={picked} onValueChange={setPicked}>
              <SelectTrigger size="sm" className="text-xs" style={{ background: 'var(--surface)', maxWidth: 150 }}>
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
          <button onClick={() => setOpen(false)} className="rounded-md p-1 transition hover:bg-white/5" style={{ color: 'var(--muted-foreground)' }}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Hi! I can look up real events, check your forecasts, and help plan an event. Ask away.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start'}>
            <div
              className="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
              style={m.role === 'user'
                ? { background: '#ff4d2e', color: '#fff' }
                : { background: 'var(--surface-2)', color: 'var(--foreground)' }}
            >
              {m.content}
            </div>
            {m.via && <div className="mt-0.5 px-1 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>via {m.via}</div>}
          </div>
        ))}
        {busy && <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Thinking…</div>}
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
        <button
          onClick={submit}
          disabled={busy || !input.trim()}
          className="flex size-9 items-center justify-center rounded-lg text-white transition disabled:opacity-40"
          style={{ background: '#ff4d2e' }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
