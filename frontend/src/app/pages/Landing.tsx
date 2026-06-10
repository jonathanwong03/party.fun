import { useMemo, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { EventCard } from '../components/EventCard';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { eventBadgeKey, type EventItem, type Route } from '../components/types';


export function Landing({
  go,
  myEventIds = new Set<string>(),
  cancelledEventIds = new Set<string>(),
  events,
  loading = false,
  error = null,
}: {
  go: (r: Route) => void;
  myEventIds?: Set<string>;
  cancelledEventIds?: Set<string>;
  events: EventItem[];
  loading?: boolean;
  error?: string | null;
}) {
  // Filter and search query states
  const [q, setQ] = useState('');
  const [hype, setHype] = useState('all');
  const [price, setPrice] = useState('all');

  // 3. Hide events the user has already pledged for (they reside in "My Events", not here)
  //    and events the organiser created themselves (those belong only in the organiser dashboard).
  const available = useMemo(
    () => events.filter((e) => !myEventIds.has(e.id) && !e.mine && e.status !== 'cancelled' && !cancelledEventIds.has(e.id)),
    [events, myEventIds, cancelledEventIds],
  );
  // "Most hyped" = highest raw fill ratio (uncapped, so 106% beats 105% even though
  // both display as 100%); ties keep the first encountered.
  const rawHype = (e: EventItem) => (e.hypeThreshold > 0 ? e.activeTicketCount / e.hypeThreshold : 0);
  const featured = available.length ? available.reduce((best, e) => (rawHype(e) > rawHype(best) ? e : best)) : undefined;
  const rest = available.filter((e) => e.id !== featured?.id);

  const filtered = useMemo(() => {
    return rest.filter((e) => {
      if (q && !`${e.title} ${e.organiser}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (price === 'lt15' && e.price >= 15) return false;
      if (price === '15-25' && (e.price < 15 || e.price > 25)) return false;
      if (price === 'gt25' && e.price <= 25) return false;
      if (hype !== 'all' && eventBadgeKey(e) !== hype) return false;
      return true;
    });
  }, [q, hype, price, rest]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1536px] px-6 py-20 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Loading campus campaigns...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1536px] px-6 py-20 text-center text-sm" style={{ color: '#ff9a82' }}>
        Unable to load events from the backend.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-10">
      {/* Hero */}
      <section className="relative mb-10 overflow-hidden rounded-3xl border p-8 md:p-12"
        style={{ borderColor: 'var(--border)', background: 'linear-gradient(135deg, rgba(255,77,46,0.18), rgba(124,92,255,0.10) 50%, rgba(41,224,122,0.10))' }}>
        <div className="pointer-events-none absolute -right-20 -top-20 size-[420px] rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(255,77,46,0.35), transparent 70%)' }} />
        <div className="relative max-w-2xl">
          
          <h1 className="mt-4" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em' }}>Greenlit the parties <span style={{ color: '#ff4d2e' }}>your campus</span> actually wants.</h1>
          <p className="mt-4 max-w-xl text-base" style={{ color: 'var(--muted-foreground)' }}>
            Pledge early, pay less. If the event reaches its hype threshold, it is confirmed. If not, active tickets are automatically refunded.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>✓ Refund-guaranteed</span>
            <span className="rounded-full border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>✓ Buy early, pay less</span>
          </div>
        </div>
      </section>

      {/* Featured */}
      {featured && (
        <>
          <div className="mb-4 flex items-baseline justify-between">
            <h2>Most Hyped</h2>
          </div>
          <div className="mb-12">
            <EventCard event={featured} featured onView={() => go({ name: 'event', id: featured.id })} />
          </div>
        </>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search events, organisers..."
            className="pl-9"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          />
        </div>
        <Select value={price} onValueChange={setPrice}>
          <SelectTrigger className="w-full md:w-36" style={{ background: 'var(--surface)' }}>
            <SelectValue placeholder="Price" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any price</SelectItem>
            <SelectItem value="lt15">Under $15</SelectItem>
            <SelectItem value="15-25">$15 – $25</SelectItem>
            <SelectItem value="gt25">Over $25</SelectItem>
          </SelectContent>
        </Select>
        <Select value={hype} onValueChange={setHype}>
          <SelectTrigger className="w-full md:w-40" style={{ background: 'var(--surface)' }}>
            <SelectValue placeholder="Hype level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All hype</SelectItem>
            <SelectItem value="early_bird">Early Birds</SelectItem>
            <SelectItem value="greenlit">Greenlit</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((e) => (
          <EventCard key={e.id} event={e} onView={() => go({ name: 'event', id: e.id })} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="grid place-items-center rounded-2xl border py-20 text-center" style={{ borderColor: 'var(--border)' }}>
          <p style={{ color: 'var(--muted-foreground)' }}>No events match those filters.</p>
        </div>
      )}
    </div>
  );
}
