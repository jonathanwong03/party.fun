import { useEffect, useState } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import type { Route } from '../components/types';
import { fetchReviewableEvents, submitReview, type ReviewableEvent } from '../api';
import { GOLD } from '../components/StarDisplay';

// Interactive 1-5 star picker.
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= (hover || value);
        return (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(n)}
            className="p-0.5 transition hover:scale-110"
          >
            <Star size={26} color={filled ? GOLD : 'var(--muted-foreground)'} fill={filled ? GOLD : 'none'} />
          </button>
        );
      })}
    </div>
  );
}

function ReviewForm({ event, onDone }: { event: ReviewableEvent; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!rating) { setError('Pick a star rating first.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await submitReview(event.id, rating, body.trim());
      if (res.status && res.status !== 'ok') { setError(res.message ?? 'Unable to submit review.'); return; }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to submit review.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h3 style={{ fontWeight: 700 }}>{event.title}</h3>
      <div className="mt-3"><StarPicker value={rating} onChange={setRating} /></div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Share how it went (optional)…"
        className="mt-3 w-full rounded-lg border p-3 text-sm"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
      />
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--status-red)' }}>{error}</p>}
      <button
        onClick={submit}
        disabled={busy}
        className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
        style={{ background: '#ff4d2e' }}
      >
        {busy ? 'Submitting…' : 'Submit review'}
      </button>
    </div>
  );
}

export function Review({ go }: { go: (r: Route) => void }) {
  const [reviewable, setReviewable] = useState<ReviewableEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const e = await fetchReviewableEvents();
      setReviewable(e.events ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reviews.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <button onClick={() => go({ name: 'landing' })} className="mb-6 inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted-foreground)' }}>
        <ArrowLeft size={16} /> Back to events
      </button>

      <h1 style={{ color: 'var(--foreground)', fontWeight: 800, fontSize: 28, letterSpacing: '-0.02em' }}>Reviews</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>Rate the events you attended. Your review appears on the events page for other students to see.</p>

      {loading ? (
        <p className="mt-8 text-sm" style={{ color: 'var(--muted-foreground)' }}>Loading…</p>
      ) : error ? (
        <p className="mt-8 text-sm" style={{ color: 'var(--status-red)' }}>{error}</p>
      ) : reviewable.length === 0 ? (
        <div className="mt-8 rounded-2xl border p-6 text-center text-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--muted-foreground)' }}>
          Nothing to review right now. Once an event you joined has finished, it'll show up here.
        </div>
      ) : (
        <section className="mt-8">
          <h2 className="mb-3" style={{ fontWeight: 700, fontSize: 18 }}>Events you can review</h2>
          <div className="space-y-3">
            {reviewable.map((e) => (
              <ReviewForm key={e.id} event={e} onDone={load} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
