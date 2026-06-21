import { useState } from 'react';
import { Calendar, MapPin, Ticket as TicketIcon, ArrowRight, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { getActiveStatus, type Route, type EventItem } from '../components/types';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { DEFAULT_EVENT_IMAGE } from '../components/media';
import type { ProfileTicket, ProfileCounts } from '../api';

type Tab = 'upcoming' | 'past' | 'cancelled';
type Row = ProfileTicket & { event: EventItem };

export function JoinedEvents({ go, events, tickets, counts, onDelete }: { go: (route: Route) => void; events: EventItem[]; tickets: ProfileTicket[]; counts: ProfileCounts; onDelete: (bookingId: string) => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [deleting, setDeleting] = useState<Row | null>(null);
  const rows = tickets
    .map((booking) => {
      const event = events.find((candidate) => candidate.id === booking.eventId);
      return event ? { ...booking, event } : null;
    })
    .filter((row): row is Row => !!row && !row.event.mine);
  const items = rows.filter((row) => row.tab === tab);

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-8">
      <div className="mb-8 flex justify-around gap-4 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <Stat label="Pledged" value={String(counts.upcoming)} />
        <Stat label="Completed" value={String(counts.past)} />
        <Stat label="Cancelled" value={String(counts.cancelled)} />
      </div>

      <div className="mb-6 flex items-baseline justify-between">
        <h2>Joined Events</h2>
        <Button onClick={() => go({ name: 'landing' })} variant="outline" className="border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 9999 }}>
          Browse more
        </Button>
      </div>

      <div className="mb-5 flex gap-2 rounded-full border p-1" style={{ borderColor: 'var(--border)', background: 'var(--surface)', width: 'fit-content' }}>
        {(['upcoming', 'past', 'cancelled'] as Tab[]).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className="rounded-full px-4 py-1.5 text-sm capitalize transition"
            style={{ background: tab === value ? '#ff4d2e' : 'transparent', color: tab === value ? '#fff' : 'var(--muted-foreground)', fontWeight: 600 }}
          >
            {value}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border py-20 text-center" style={{ borderColor: 'var(--border)' }}>
          <div className="grid size-14 place-items-center rounded-full" style={{ background: 'rgba(255,77,46,0.12)' }}>
            <TicketIcon size={22} style={{ color: '#ff4d2e' }} />
          </div>
          <h3 className="mt-3">Nothing here yet</h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>When you pledge for an event, it will show up here.</p>
          <Button onClick={() => go({ name: 'landing' })} className="mt-4 bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 9999 }}>
            Browse events <ArrowRight size={14} className="ml-1" />
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((booking) => {
            const isCancelled = booking.tab === 'cancelled';
            // Distinguish an organiser-cancelled event (refunded) from a buyer giving away all tickets.
            const eventCancelled = booking.event.status === 'cancelled';
            const badgeLabel = booking.tab === 'past'
              ? 'Completed'
              : eventCancelled
              ? 'Cancelled by Organiser'
              : isCancelled
              ? 'Cancelled by Buyer'
              : undefined;
            return (
              <div key={booking.bookingId} className="flex flex-col gap-4 rounded-2xl border p-4 md:flex-row md:items-center" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="relative h-24 w-full overflow-hidden rounded-xl md:w-40 md:shrink-0">
                  <ImageWithFallback src={booking.event.image || DEFAULT_EVENT_IMAGE} alt={booking.event.title} className="size-full object-cover" />
                  {!booking.event.image && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.28)' }} />}
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="line-clamp-1">{booking.event.title}</h3>
                    <StatusBadge event={booking.event} label={badgeLabel} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    <span className="flex items-center gap-1"><Calendar size={12} /> {booking.event.date}</span>
                    <span className="flex items-center gap-1"><MapPin size={12} /> {booking.event.location.split(',')[0]}</span>
                    {!isCancelled && <span>Tickets pledged: {booking.activeTicketCount}</span>}
                  </div>
                  <div className="mt-3 max-w-md">
                    <HypeMeter pct={booking.event.hypePercentage} status={isCancelled ? 'cancelled' : booking.event.status} statusIndex={getActiveStatus(booking.event)} size="sm" showLabel={false} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => go(isCancelled
                      ? { name: 'event', id: booking.event.id }
                      : { name: 'event', id: booking.event.id, fromProfile: true, bookingId: booking.bookingId, qty: booking.activeTicketCount })}
                    variant="outline"
                    className="border-white/15 bg-transparent hover:bg-white/5"
                    style={{ borderRadius: 9999 }}
                  >
                    View
                  </Button>
                  {(booking.tab === 'cancelled' || booking.tab === 'past') && (
                    <button
                      onClick={() => setDeleting(booking)}
                      aria-label="Delete"
                      title="Delete"
                      className="grid size-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/5"
                      style={{ color: '#ff3354' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleting && (
        <ConfirmDeleteModal
          eventName={deleting.event.title}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await onDelete(deleting.bookingId);
            setDeleting(null);
          }}
        />
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
