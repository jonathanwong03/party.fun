import { useState } from 'react';
import { Calendar, MapPin, Ticket as TicketIcon, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { StatusBadge } from '../components/StatusBadge';
import { MOCK_EVENTS, getActiveTier, type Route, type EventItem } from '../components/types';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';

type Tab = 'upcoming' | 'past' | 'cancelled';

const MY_TICKETS: { event: EventItem; qty: number; amount: number; tab: Tab; ticketStatus: string }[] = [
  { event: MOCK_EVENTS[0], qty: 1, amount: 18, tab: 'upcoming', ticketStatus: 'Pledged' },
  { event: MOCK_EVENTS[1], qty: 2, amount: 20, tab: 'upcoming', ticketStatus: 'Pledged' },
  { event: MOCK_EVENTS[2], qty: 1, amount: 28, tab: 'past', ticketStatus: 'Attended' },
  { event: MOCK_EVENTS[5], qty: 1, amount: 8, tab: 'cancelled', ticketStatus: 'Refunded' },
];

export function Profile({ go, added = [] }: { go: (r: Route) => void; added?: { eventId: string; qty: number; amount: number }[] }) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const addedTickets = added
    .map((a) => {
      const ev = MOCK_EVENTS.find((e) => e.id === a.eventId);
      if (!ev) return null;
      return { event: ev, qty: a.qty, amount: a.amount, tab: 'upcoming' as Tab, ticketStatus: 'Pledged' };
    })
    .filter(Boolean) as { event: EventItem; qty: number; amount: number; tab: Tab; ticketStatus: string }[];
  const merged = [...addedTickets, ...MY_TICKETS.filter((t) => !addedTickets.some((a) => a.event.id === t.event.id))];
  const items = merged.filter((t) => t.tab === tab);

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-8">
      {/* Profile summary */}
      <div className="mb-8 flex flex-wrap items-center gap-5 rounded-2xl border p-6"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="grid size-16 place-items-center rounded-full"
          style={{ background: 'linear-gradient(135deg,#ff4d2e,#ffcb3c)', fontWeight: 800, fontSize: 22, color: '#0b0b0f' }}>
          JT
        </div>
        <div className="flex-1">
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>Jamie Tan</h1>
          <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>@jamiet · jamie@u.nus.edu</div>
        </div>
        <div className="flex gap-6">
          <Stat label="Pledged" value="2" />
          <Stat label="Confirmed" value="0" />
          <Stat label="Refunded" value="1" />
        </div>
      </div>

      <div className="mb-6 flex items-baseline justify-between">
        <h2>My Events</h2>
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
            {t === 'cancelled' ? 'Cancelled / Refunded' : t}
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
          {items.map(({ event, qty, amount, ticketStatus }) => (
            <div key={event.id} className="flex flex-col gap-4 rounded-2xl border p-4 md:flex-row md:items-center"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="relative h-24 w-full overflow-hidden rounded-xl md:w-40 md:shrink-0">
                <ImageWithFallback src={event.image} alt={event.title} className="size-full object-cover" />
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="line-clamp-1">{event.title}</h3>
                  <StatusBadge status={event.status} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  <span className="flex items-center gap-1"><Calendar size={12} /> {event.date}</span>
                  <span className="flex items-center gap-1"><MapPin size={12} /> {event.location.split(',')[0]}</span>
                  <span>Ticket: {ticketStatus} · {qty} × ${amount}</span>
                </div>
                <div className="mt-3 max-w-md">
                  <HypeMeter pct={event.hypePct} status={event.status} tier={getActiveTier(event)} size="sm" showLabel={false} />
                </div>
              </div>
              <div className="flex items-center gap-3 md:flex-col md:items-end">
                <div className="text-right">
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Total</div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>${(qty * amount).toFixed(2)}</div>
                </div>
                <Button onClick={() => go({ name: 'event', id: event.id, fromProfile: true })} variant="outline"
                  className="border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 9999 }}>
                  View
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{label}</div>
    </div>
  );
}
