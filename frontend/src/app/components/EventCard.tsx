import { Calendar, MapPin } from 'lucide-react';
import { Button } from './ui/button';
import { HypeMeter } from './HypeMeter';
import { StatusBadge } from './StatusBadge';
import { getActiveStatus, type EventItem } from './types';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { DEFAULT_EVENT_IMAGE } from './media';

export function EventCard({
  event,
  onView,
  featured = false,
  alreadyPurchased = false,
}: {
  event: EventItem;
  onView: () => void;
  featured?: boolean;
  alreadyPurchased?: boolean;
}) {
  const statusIndex = getActiveStatus(event);

  return (
    <div
      className={`group flex flex-col overflow-hidden rounded-2xl border transition hover:-translate-y-0.5 hover:border-[rgba(255,77,46,0.4)] ${alreadyPurchased ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d2e]' : ''}`}
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      role={alreadyPurchased ? 'button' : undefined}
      tabIndex={alreadyPurchased ? 0 : undefined}
      onClick={alreadyPurchased ? onView : undefined}
      onKeyDown={alreadyPurchased ? (eventKey) => {
        if (eventKey.key === 'Enter' || eventKey.key === ' ') {
          eventKey.preventDefault();
          onView();
        }
      } : undefined}
    >
      <div className={`relative ${featured ? 'h-64' : 'h-44'} overflow-hidden`}>
        <ImageWithFallback
          src={event.image || DEFAULT_EVENT_IMAGE}
          alt={event.title}
          className="size-full object-cover transition group-hover:scale-105"
        />
        {!event.image && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.28)' }} />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div className="absolute left-3 top-3">
          <StatusBadge event={event} />
        </div>
        {/* Hype % badge */}
        <div
          className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs backdrop-blur"
          style={{ background: 'rgba(0,0,0,0.55)', color: '#ffffff', fontWeight: 700 }}
        >
          <span className="size-1.5 rounded-full" style={{ background: '#ffffff', boxShadow: '0 0 5px rgba(255,255,255,0.6)' }} />
          {event.hypePercentage}%
        </div>
        <div className="absolute inset-x-3 bottom-3">
          <h3 className="line-clamp-2 text-white" style={{ fontSize: featured ? 22 : 16, fontWeight: 700, lineHeight: 1.2 }}>
            {event.title}
          </h3>
          <p className="text-xs text-white/60 mt-0.5">{event.organiser}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Calendar size={12} /> {event.date}</span>
            <span className="flex items-center gap-1"><MapPin size={12} /> {event.location.split(',')[0]}</span>
          </div>
          <span style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>${event.price}</span>
        </div>

        <div className="space-y-1">
          <HypeMeter pct={event.hypePercentage} status={event.status} statusIndex={statusIndex} size="sm" showLabel={false} />
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: '#ffffff', fontWeight: 600 }}>
              {event.activeTicketCount} of {event.hypeThreshold} tickets pledged
            </span>
            <span style={{ color: 'var(--muted-foreground)' }}>{event.spotsLeft} spots left</span>
          </div>
        </div>

        {alreadyPurchased ? (
          <p className="mt-auto py-2 text-center text-sm" style={{ color: 'var(--muted-foreground)', fontWeight: 600 }}>
            Tickets already purchased
          </p>
        ) : (
          <Button
            size="sm"
            onClick={onView}
            className="mt-auto w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]"
            style={{ borderRadius: 9999 }}
            disabled={event.status === 'cancelled' || event.status === 'completed'}
          >
            {event.status === 'greenlit'
              ? `Buy Ticket · $${event.price}`
              : event.status === 'cancelled'
              ? 'Cancelled'
              : event.status === 'completed'
              ? 'Completed'
              : `Pledge · $${event.price}`}
          </Button>
        )}
      </div>
    </div>
  );
}
