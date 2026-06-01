import { Calendar, MapPin } from 'lucide-react';
import { Button } from './ui/button';
import { HypeMeter } from './HypeMeter';
import { StatusBadge } from './StatusBadge';
import { getActiveTier, TIER_COLORS, type EventItem } from './types';
import { ImageWithFallback } from './figma/ImageWithFallback';

export function EventCard({
  event,
  onView,
  featured = false,
}: {
  event: EventItem;
  onView: () => void;
  featured?: boolean;
}) {
  const tier = getActiveTier(event);
  const tierColor = event.status === 'cancelled' ? '#5a5a66' : TIER_COLORS[tier];

  return (
    <div
      className="group flex flex-col overflow-hidden rounded-2xl border transition hover:-translate-y-0.5 hover:border-[rgba(255,77,46,0.4)]"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <div className={`relative ${featured ? 'h-64' : 'h-44'} overflow-hidden`}>
        <ImageWithFallback
          src={event.image}
          alt={event.title}
          className="size-full object-cover transition group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div className="absolute left-3 top-3">
          <StatusBadge status={event.status} />
        </div>
        {/* Hype % badge */}
        <div
          className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs backdrop-blur"
          style={{ background: 'rgba(0,0,0,0.55)', color: '#ffffff', fontWeight: 700 }}
        >
          <span className="size-1.5 rounded-full" style={{ background: '#ffffff', boxShadow: '0 0 5px rgba(255,255,255,0.6)' }} />
          {event.hypePct}%
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
          <HypeMeter pct={event.hypePct} status={event.status} tier={tier} size="sm" showLabel={false} />
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: '#ffffff', fontWeight: 600 }}>
              {event.backers} of {event.threshold} backers
            </span>
            <span style={{ color: 'var(--muted-foreground)' }}>{event.spotsLeft} spots left</span>
          </div>
        </div>

        <Button
          size="sm"
          onClick={onView}
          className="mt-auto w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]"
          style={{ borderRadius: 9999 }}
          disabled={event.status === 'cancelled'}
        >
          {event.status === 'greenlit'
            ? `Buy Ticket · $${event.price}`
            : event.status === 'cancelled'
            ? 'Cancelled'
            : `Pledge · $${event.price}`}
        </Button>
      </div>
    </div>
  );
}
