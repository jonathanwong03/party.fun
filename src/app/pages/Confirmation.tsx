import { useEffect } from 'react';
import { CheckCircle2, Calendar, MapPin, Ticket, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { MOCK_EVENTS, getActiveTier, type Role, type Route } from '../components/types';

export function Confirmation({ id, qty, go, onAdd }: { id: string; qty: number; role: Role; go: (r: Route) => void; onAdd?: (t: { eventId: string; qty: number; amount: number }) => void }) {
  const event = MOCK_EVENTS.find((e) => e.id === id) ?? MOCK_EVENTS[0];
  const ref = 'PF-' + event.id.toUpperCase() + '-' + String(Math.floor(Math.random() * 9000) + 1000);

  useEffect(() => {
    onAdd?.({ eventId: event.id, qty, amount: event.price });
  }, [event.id, qty, event.price]);

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-16">
      <div className="text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-full"
          style={{ background: 'rgba(41,224,122,0.15)', border: '1px solid rgba(41,224,122,0.4)' }}>
          <CheckCircle2 size={28} style={{ color: '#29e07a' }} />
        </div>
        <h1 className="mt-5" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
          You're in. Hype incoming.
        </h1>
        <p className="mt-2" style={{ color: 'var(--muted-foreground)' }}>
          Your pledge is locked. We'll capture the funds only when the event hits its threshold.
        </p>
      </div>

      <div className="mt-8 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-baseline justify-between">
          <h3>{event.title}</h3>
          <span className="rounded-full px-2.5 py-1 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--muted-foreground)' }}>
            Ref: {ref}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <Meta icon={Calendar} label="Date" value={`${event.date} · ${event.time}`} />
          <Meta icon={MapPin} label="Location" value={event.location.split(',')[0]} />
          <Meta icon={Ticket} label="Tickets" value={`${qty} × $${event.price}`} />
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span style={{ color: 'var(--muted-foreground)' }}>Current hype</span>
            <span style={{ fontWeight: 600 }}>{event.backers + qty} / {event.threshold} backers</span>
          </div>
          <HypeMeter pct={Math.min(100, event.hypePct + 2)} status={event.status} tier={getActiveTier(event)} size="md" showLabel={false} />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <h3 className="mb-3">What happens next</h3>
        <ol className="space-y-3 text-sm" style={{ color: 'var(--muted-foreground)' }}><li>Hype builds toward the threshold by {event.deadline}.</li><li>If greenlit, your card is charged and your ticket is emailed.</li><li>If the threshold isn't reached, you're refunded automatically. No questions.</li></ol>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button
          variant="outline"
          onClick={() => go({ name: 'landing' })}
          className="flex-1 border-white/15 bg-transparent hover:bg-white/5"
          style={{ borderRadius: 12, height: 48 }}
        >
          Back to Events
        </Button>
        <Button
          onClick={() => go({ name: 'profile' })}
          className="flex-1 bg-[#ff4d2e] text-white hover:bg-[#ff6647]"
          style={{ borderRadius: 12, height: 48 }}
        >
          View My Events <ArrowRight size={16} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

function Meta({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
        <Icon size={12} /> {label}
      </div>
      <div className="mt-1 truncate" style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}
