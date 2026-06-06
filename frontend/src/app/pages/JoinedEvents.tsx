import { useState } from 'react';
import { Calendar, MapPin, Ticket as TicketIcon, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { StatusBadge } from '../components/StatusBadge';
import { getActiveTier, type Route, type EventItem } from '../components/types';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import type { ProfileTicket } from '../api';

type Tab = 'upcoming' | 'past' | 'cancelled';
type Row = { event: EventItem; qty: number; amount: number; total: number; tab: Tab; ticketStatus: string };

export function JoinedEvents({
  go,
  events,
  tickets,
}: {
  go: (r: Route) => void;
  events: EventItem[];
  tickets: ProfileTicket[];
}) {
  const [tab, setTab] = useState<Tab>('upcoming');
  // Resolve each row's event from the live `events` state so pledged events reflect updated backers/tiers.
  const resolve = (id: string) => events.find((e) => e.id === id);
  const toRow = (t: ProfileTicket) => {
    const ev = resolve(t.eventId);
    return ev ? { event: ev, qty: t.qty, amount: t.amount, total: t.total, tab: t.tab, ticketStatus: t.ticketStatus } : null;
  };
  // "My Events" lists events you pledged/bought — never your own created events (mine).
  const merged = (tickets.map(toRow).filter(Boolean) as Row[]).filter((r) => !r.event.mine);
  const items = merged.filter((t) => t.tab === tab);
  const pledgedCount = merged.filter((t) => t.tab === 'upcoming').length;
  const confirmedCount = merged.filter((t) => t.tab === 'past').length;
  const refundedCount = merged.filter((t) => t.tab === 'cancelled').length;

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-8">
      {/* Ticket stats */}
      <div className="mb-8 flex justify-around gap-4 rounded-2xl border p-6"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <Stat label="Pledged" value={String(pledgedCount)} />
        <Stat label="Confirmed" value={String(confirmedCount)} />
        <Stat label="Refunded" value={String(refundedCount)} />
      </div>

      <div className="mb-6 flex items-baseline justify-between">
        <h2>Joined Events</h2>
        <Button onClick={() => go({ name: 'landing' })} variant="outline" className="border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 9999 }}>
          Browse more
        </Button>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-2 rounded-full border p-1" style={{ borderColor: 'var(--border)', background: 'var(--surface)', width: 'fit-content' }}>
        {(['upcoming', 'past', 'cancelled'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded-full px-4 py-1.5 text-sm capitalize transition"
            style={{
              background: tab === t ? '#ff4d2e' : 'transparent',
              color: tab === t ? '#fff' : 'var(--muted-foreground)',
              fontWeight: 600,
            }}
          >
            {t === 'cancelled' ? 'Cancelled' : t}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border py-20 text-center" style={{ borderColor: 'var(--border)' }}>
          <div className="grid size-14 place-items-center rounded-full" style={{ background: 'rgba(255,77,46,0.12)' }}>
            <TicketIcon size={22} style={{ color: '#ff4d2e' }} />
          </div>
          <h3 className="mt-3">Nothing here yet</h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            When you pledge for an event, it'll show up here.
          </p>
          <Button onClick={() => go({ name: 'landing' })} className="mt-4 bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 9999 }}>
            Browse events <ArrowRight size={14} className="ml-1" />
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(({ event, qty, amount, total, ticketStatus }) => {
            // A cancelled-tab ticket is either a buyer opt-out ('Cancelled', no refund) or an
            // event-failure refund ('Refunded'); both are read-only here.
            const isCancelledTicket = tab === 'cancelled';
            const badgeLabel =
              tab === 'past' ? 'Not available'
              : event.status === 'cancelled' ? undefined        // -> eventBadge: "Cancelled by Organiser"
              : isCancelledTicket ? 'Cancelled by Buyer'
              : undefined;                                       // -> eventBadge: tier label
            const greyMeter = !!badgeLabel || event.status === 'cancelled';
            return (
            <div key={event.id} className="flex flex-col gap-4 rounded-2xl border p-4 md:flex-row md:items-center"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="relative h-24 w-full overflow-hidden rounded-xl md:w-40 md:shrink-0">
                <ImageWithFallback src={event.image} alt={event.title} className="size-full object-cover" />
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="line-clamp-1">{event.title}</h3>
                  <StatusBadge event={event} label={badgeLabel} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  <span className="flex items-center gap-1"><Calendar size={12} /> {event.date}</span>
                  <span className="flex items-center gap-1"><MapPin size={12} /> {event.location.split(',')[0]}</span>
                  <span>Ticket: {ticketStatus} · {qty} × ${amount}</span>
                </div>
                <div className="mt-3 max-w-md">
                  <HypeMeter pct={event.hypePct} status={greyMeter ? 'cancelled' : event.status} tier={getActiveTier(event)} size="sm" showLabel={false} />
                </div>
              </div>
              <div className="flex items-center gap-3 md:flex-col md:items-end">
                <div className="text-right">
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Total</div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>${total.toFixed(2)}</div>
                </div>
                <Button onClick={() => go(tab === 'past' ? { name: 'event', id: event.id, fromPast: true } : isCancelledTicket ? { name: 'event', id: event.id } : { name: 'event', id: event.id, fromProfile: true, qty, amount, total })} variant="outline"
                  className="border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 9999 }}>
                  View
                </Button>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{label}</div>
    </div>
  );
}
