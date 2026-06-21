import { CheckCircle2, Calendar, MapPin, Ticket, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { getActiveStatus, type EventItem, type Role, type Route } from '../components/types';

export function Confirmation({ id, qty, lines, go, events }: { id: string; qty: number; lines?: { label: string; count: number; subtotalText: string }[]; reference?: string; role: Role; go: (r: Route) => void; events: EventItem[] }) {
  const event = events.find((e) => e.id === id);
  if (!event) {
    return (
      <div className="mx-auto max-w-[1536px] px-6 py-20 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Loading confirmation...
      </div>
    );
  }

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
          Your payment was captured and your tickets are locked in.
        </p>
        <p className="mt-2 text-sm" style={{ color: '#29e07a', fontWeight: 600 }}>
          A confirmation email has been sent to your inbox.
        </p>
      </div>

      <div className="mt-8 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-baseline justify-between">
          <h3>{event.title}</h3>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <Meta icon={Calendar} label="Date" value={`${event.date} · ${event.time}`} />
          <Meta icon={MapPin} label="Location" value={event.location.split(',')[0]} />
          <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
              <Ticket size={12} /> Tickets
            </div>
            <div className="mt-1 space-y-0.5" style={{ fontWeight: 600 }}>
              {lines && lines.length > 0 ? (
                lines.map((l) => (
                  <div key={l.label} className="flex items-baseline justify-between gap-2">
                    <span>{l.count} × {l.label}</span>
                    <span>{l.subtotalText}</span>
                  </div>
                ))
              ) : (
                <div>{qty} × ${event.price}</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span style={{ color: 'var(--muted-foreground)' }}>Current hype</span>
            <span style={{ fontWeight: 600 }}>{event.activeTicketCount} / {event.hypeThreshold} tickets</span>
          </div>
          <HypeMeter pct={event.hypePercentage} status={event.status} statusIndex={getActiveStatus(event)} size="md" showLabel={false} />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <h3 className="mb-3">What happens next</h3>
        <ol className="space-y-3 text-sm" style={{ color: 'var(--muted-foreground)' }}><li>Hype builds toward the threshold by {event.deadline}.</li><li>If the threshold is reached, the event is confirmed.</li><li>If the threshold is not reached, active tickets are refunded automatically.</li></ol>
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
          onClick={() => go({ name: 'joined-events' })}
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
