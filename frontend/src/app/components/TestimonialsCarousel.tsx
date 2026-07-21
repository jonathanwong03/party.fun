import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Review } from '../api';
import { StarDisplay } from './StarDisplay';

const ACCENT = '#ff4d2e';

// Avatar is optional — OAuth signups and anyone who never set one have avatarUrl = null,
// so fall back to the first letter of their username.
function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return <img src={url} alt={name} className="mx-auto mb-4 size-20 rounded-full object-cover" />;
  }
  return (
    <div
      className="mx-auto mb-4 grid size-20 place-items-center rounded-full"
      style={{ background: 'var(--border)', color: 'var(--muted-foreground)', fontWeight: 700, fontSize: 26 }}
      aria-label={name}
    >
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  );
}

// Real user reviews, newest first (the backend returns at most 20). Wraps back to the
// first after the last, so the loop length follows however many reviews exist.
export function TestimonialsCarousel({ reviews }: { reviews: Review[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = reviews.length;

  // Guard the index: a shrinking list (or a refetch) must not leave it out of range.
  useEffect(() => { setI((c) => (n === 0 ? 0 : c % n)); }, [n]);

  useEffect(() => {
    if (paused || n <= 1) return undefined;
    const t = setInterval(() => setI((c) => (c + 1) % n), 4000);
    return () => clearInterval(t);
  }, [n, paused]);

  if (n === 0) return null;

  const next = () => setI((c) => (c + 1) % n);
  const prev = () => setI((c) => (c - 1 + n) % n);
  const r = reviews[Math.min(i, n - 1)];
  const arrowBtn = 'grid size-9 place-items-center rounded-full border transition hover:bg-white/5';

  return (
    <section
      className="my-12 rounded-2xl border px-4 py-10"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <h2 className="mb-8 text-center" style={{ color: 'var(--foreground)', fontWeight: 700, fontSize: 22, letterSpacing: '0.04em' }}>WHAT STUDENTS SAY</h2>

      <div className="mx-auto flex max-w-3xl items-center gap-3 sm:gap-6">
        <button onClick={prev} aria-label="Previous" className={arrowBtn} style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
          <ChevronLeft size={18} />
        </button>

        <div className="min-h-[13rem] flex-1 text-center">
          <Avatar url={r.avatarUrl} name={r.username} />

          {/* A review can be stars-only, in which case there is no quote to show. */}
          {r.body?.trim() && (
            <p className="mx-auto max-w-xl text-base" style={{ color: 'var(--foreground)', lineHeight: 1.6 }}>
              &ldquo;{r.body.trim()}&rdquo;
            </p>
          )}

          <div className="mt-4 flex justify-center">
            <StarDisplay rating={r.rating} size={20} />
          </div>

          <p className="mt-3" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{r.username}</p>
          {r.university && <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{r.university}</p>}
        </div>

        <button onClick={next} aria-label="Next" className={arrowBtn} style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mt-6 flex justify-center gap-2">
        {reviews.map((rev, idx) => (
          <button
            key={rev.id}
            onClick={() => setI(idx)}
            aria-label={`Go to review ${idx + 1}`}
            className="size-2 rounded-full transition"
            style={{ background: idx === i ? ACCENT : 'var(--border)' }}
          />
        ))}
      </div>
    </section>
  );
}
