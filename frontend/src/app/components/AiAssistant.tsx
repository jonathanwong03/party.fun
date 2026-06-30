import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';
import { sendChat, type ChatMessage } from '../api';

// Floating AI assistant: a launcher button + chat panel. Grounded Q&A about the
// app plus event-planning brainstorming. Hides itself if the backend reports no
// AI provider is configured ({available:false}).
export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await sendChat(next);
      if (!res.available) { setHidden(true); return; }
      setMessages([...next, { role: 'assistant', content: res.reply ?? 'Sorry, I had trouble answering.' }]);
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
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <span className="flex items-center gap-2" style={{ fontWeight: 700 }}>
          <Sparkles size={16} style={{ color: '#ff4d2e' }} /> party.fun assistant
        </span>
        <button onClick={() => setOpen(false)} className="rounded-md p-1 transition hover:bg-white/5" style={{ color: 'var(--muted-foreground)' }}>
          <X size={18} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Hi! Ask me how the app works (wallet vs card, refunds, hype pricing) or for help planning an event.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
              style={m.role === 'user'
                ? { background: '#ff4d2e', color: '#fff' }
                : { background: 'var(--surface-2)', color: 'var(--foreground)' }}
            >
              {m.content}
            </div>
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
