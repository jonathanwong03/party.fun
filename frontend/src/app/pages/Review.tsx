import { useEffect, useState } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import type { Route } from '../components/types';
import { fetchReviews, fetchReviewableEvents, submitReview, type Review as ReviewItem, type ReviewableEvent } from '../api';

const GOLD = '#ffcb3c';

// Read-only star row for a submitted review.
function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={16} color={n <= rating ? GOLD : 'var(--muted-foreground)'} fill={n <= rating ? GOLD : 'none'} />
      ))}
    </div>
  );
}

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
      {error && <p className="mt-2 text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
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
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [reviewable, setReviewable] = useState<ReviewableEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [r, e] = await Promise.all([fetchReviews(), fetchReviewableEvents()]);
      setReviews(r.reviews ?? []);
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
      <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>Rate events you attended and see what other students said.</p>

      {loading ? (
        <p className="mt-8 text-sm" style={{ color: 'var(--muted-foreground)' }}>Loading…</p>
      ) : error ? (
        <p className="mt-8 text-sm" style={{ color: '#ff9a82' }}>{error}</p>
      ) : (
        <>
          {reviewable.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3" style={{ fontWeight: 700, fontSize: 18 }}>Events you can review</h2>
              <div className="space-y-3">
                {reviewable.map((e) => (
                  <ReviewForm key={e.id} event={e} onDone={load} />
                ))}
              </div>
            </section>
          )}

          <section className="mt-8">
            <h2 className="mb-3" style={{ fontWeight: 700, fontSize: 18 }}>All reviews</h2>
            {reviews.length === 0 ? (
              <div className="rounded-2xl border p-6 text-center text-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--muted-foreground)' }}>
                No reviews yet. Once you attend an event, you'll be able to leave the first one.
              </div>
            ) : (
              <div className="space-y-3">
                {reviews.map((r) => (
                  <div key={r.id} className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate" style={{ fontWeight: 700 }}>{r.eventTitle}</div>
                        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>by {r.username}</div>
                      </div>
                      <StarDisplay rating={r.rating} />
                    </div>
                    {r.body && <p className="mt-3 text-sm" style={{ color: 'var(--foreground)', lineHeight: 1.6 }}>{r.body}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
