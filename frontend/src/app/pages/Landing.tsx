import { useEffect, useMemo, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { EventCard } from '../components/EventCard';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { eventBadgeKey, type EventItem, type Route } from '../components/types';
import { UNIVERSITIES, universityLabel } from '../components/universities';
import { fetchEventRecommendations, fetchSemanticEventIds, type EventRecommendation } from '../api';
import { TestimonialsCarousel } from '../components/TestimonialsCarousel';


export function Landing({
  go,
  purchasedEventIds = new Set<string>(),
  events,
  loading = false,
  error = null,
}: {
  go: (r: Route) => void;
  purchasedEventIds?: Set<string>;
  events: EventItem[];
  loading?: boolean;
  error?: string | null;
}) {
  // Filter and search query states
  const [q, setQ] = useState('');
  const [hype, setHype] = useState('all');
  const [price, setPrice] = useState('all');
  const [university, setUniversity] = useState('all');
  // Semantic (vector) ranking for the search query; null = use plain substring match.
  const [semanticIds, setSemanticIds] = useState<string[] | null>(null);
  useEffect(() => {
    const query = q.trim();
    if (!query) { setSemanticIds(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      fetchSemanticEventIds(query)
        .then((r) => { if (!cancelled) setSemanticIds(r.ids?.length ? r.ids : null); })
        .catch(() => { if (!cancelled) setSemanticIds(null); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  // On the DEPLOYED free-tier backend, the first request after idle can take ~30s (Render
  // cold start). After a few seconds of loading, reassure the visitor. Production only —
  // in dev the backend is local and already running, so the message would be wrong.
  const [slowHint, setSlowHint] = useState(false);
  useEffect(() => {
    if (!loading || !import.meta.env.PROD) { setSlowHint(false); return; }
    const t = setTimeout(() => setSlowHint(true), 4000);
    return () => clearTimeout(t);
  }, [loading]);

  // Organiser-owned, globally cancelled, and completed events do not belong in discovery.
  const available = useMemo(
    () => events.filter((e) => !e.mine && e.status !== 'cancelled' && e.status !== 'completed'),
    [events],
  );
  const filteredAvailable = useMemo(() => {
    const base = available.filter((e) => {
      if (price === 'lt15' && e.price >= 15) return false;
      if (price === '15-25' && (e.price < 15 || e.price > 25)) return false;
      if (price === 'gt25' && e.price <= 25) return false;
      if (hype !== 'all' && eventBadgeKey(e) !== hype) return false;
      if (university !== 'all' && e.hostUniversity !== university) return false;
      return true;
    });
    const query = q.trim();
    if (!query) return base;
    // Semantic search: keep events in the ranked ids, ordered by relevance.
    if (semanticIds && semanticIds.length) {
      const rank = new Map(semanticIds.map((id, i) => [id, i]));
      return base.filter((e) => rank.has(e.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }
    // Fallback: substring match while the semantic result loads or is unavailable.
    return base.filter((e) => `${e.title} ${e.organiser} ${universityLabel(e.hostUniversity)}`.toLowerCase().includes(query.toLowerCase()));
  }, [available, hype, price, q, university, semanticIds]);

  // "Most hyped" is chosen by the backend (highest uncapped fill ratio among open,
  // non-owned events) and flagged as `featured`; fall back to the first available.
  const featured = filteredAvailable.find((e) => e.featured) ?? (filteredAvailable.length ? filteredAvailable[0] : undefined);
  const filtered = filteredAvailable.filter((e) => e.id !== featured?.id);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-[1536px] flex-col items-center justify-center gap-4 px-4 py-24 text-center sm:px-6">
        <div className="size-9 animate-spin rounded-full border-2 border-white/15 border-t-[#ff4d2e]" />
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Loading events…</p>
        {slowHint && (
          <p className="max-w-xs text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Waking up the server — this can take up to ~30 seconds on the first visit. Thanks for your patience!
          </p>
        )}
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
    <div className="mx-auto max-w-[1536px] px-4 py-6 sm:px-6 sm:py-10">
      {/* Hero */}
      <section className="relative mb-10 overflow-hidden rounded-3xl border p-5 sm:p-8 md:p-12"
        style={{ borderColor: 'var(--border)', background: 'linear-gradient(135deg, rgba(255,77,46,0.18), rgba(124,92,255,0.10) 50%, rgba(41,224,122,0.10))' }}>
        <div className="relative max-w-2xl">
          
          <h1 className="mt-4 text-[26px] sm:text-[34px] lg:text-[44px]" style={{ fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em' }}>Greenlit the parties <span style={{ color: '#ff4d2e' }}>your campus</span> actually wants.</h1>
          <p className="mt-4 max-w-xl text-base" style={{ color: 'var(--muted-foreground)' }}>
            Pledge early, pay less. If the event reaches its hype threshold, it is confirmed. If not, active tickets are automatically refunded.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>✓ Refund-guaranteed</span>
            <span className="rounded-full border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>✓ Buy early, pay less</span>
          </div>
        </div>
      </section>

      {/* AI recommendations */}
      <AiRecommendations
        events={available}
        onView={(id) => go({ name: 'event', id })}
        purchasedEventIds={purchasedEventIds}
      />

      {/* Featured */}
      {featured && (
        <>
          <div className="mb-4 flex items-baseline justify-between">
            <h2>Most Hyped</h2>
          </div>
          <div className="mb-12">
            <EventCard event={featured} featured alreadyPurchased={purchasedEventIds.has(featured.id)} onView={() => go({ name: 'event', id: featured.id })} />
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
        <Select value={university} onValueChange={setUniversity}>
          <SelectTrigger className="w-full md:w-72" style={{ background: 'var(--surface)' }}>
            <SelectValue placeholder="University" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All universities</SelectItem>
            {UNIVERSITIES.map((u) => (
              <SelectItem key={u.code} value={u.code}>{universityLabel(u.code)}</SelectItem>
            ))}
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
          <EventCard key={e.id} event={e} alreadyPurchased={purchasedEventIds.has(e.id)} onView={() => go({ name: 'event', id: e.id })} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="grid place-items-center rounded-2xl border py-20 text-center" style={{ borderColor: 'var(--border)' }}>
          <p style={{ color: 'var(--muted-foreground)' }}>No events match those filters.</p>
        </div>
      )}

      {/* Testimonials */}
      <TestimonialsCarousel />
    </div>
  );
}

// AI "Recommended for you": the student types interests, the assistant ranks the
// visible events (factoring cheapest price). Hides if no AI provider is configured.
function AiRecommendations({
  events,
  onView,
  purchasedEventIds,
}: {
  events: EventItem[];
  onView: (id: string) => void;
  purchasedEventIds: Set<string>;
}) {
  const [interests, setInterests] = useState('');
  const [recs, setRecs] = useState<EventRecommendation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);

  async function recommend() {
    if (loading || events.length === 0) return;
    setLoading(true);
    try {
      const res = await fetchEventRecommendations(interests);
      if (!res.available) { setHidden(true); return; }
      setRecs(res.recommendations ?? []);
    } catch {
      // leave as-is
    } finally {
      setLoading(false);
    }
  }

  if (hidden || events.length === 0) return null;
  const byId = new Map(events.map((e) => [e.id, e]));

  return (
    <section className="mb-10 rounded-3xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-center gap-2" style={{ fontWeight: 700 }}>
        <Sparkles size={18} style={{ color: '#ff4d2e' }} /> Recommended for you
      </div>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Tell us what you're into and we'll match events (cheapest first).
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') recommend(); }}
          placeholder="e.g. live music, networking, budget-friendly"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
        />
        <button
          onClick={recommend}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: '#ff4d2e' }}
        >
          <Sparkles size={15} /> {loading ? 'Matching…' : 'Recommend'}
        </button>
      </div>

      {recs && recs.length === 0 && (
        <p className="mt-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>No strong matches yet — try different interests.</p>
      )}
      {recs && recs.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {recs.map((r) => {
            const e = byId.get(r.eventId);
            if (!e) return null;
            return (
              <div key={r.eventId}>
                <EventCard event={e} alreadyPurchased={purchasedEventIds.has(e.id)} onView={() => onView(e.id)} />
                <div className="mt-1 px-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>✨ {r.reason}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
