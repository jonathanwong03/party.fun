import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const GOLD = '#d4a24e';

// Fictional party.fun testimonials. Faces are stable portrait URLs (randomuser.me).
const TESTIMONIALS = [
  { name: 'Jun Liang', role: 'SMU · Year 3', quote: 'I found my whole friend group through party.fun. Pledging early meant the event actually happened — and I got the cheapest tickets.', img: 'https://randomuser.me/api/portraits/men/32.jpg' },
  { name: 'Priya Menon', role: 'NUS · Year 2', quote: 'The recommendations are scarily good. I said I was into live music and it lined up three gigs I would never have found otherwise.', img: 'https://randomuser.me/api/portraits/women/44.jpg' },
  { name: 'Marcus Tan', role: 'Event Organiser', quote: 'As an organiser, seeing real demand before committing a cent changed everything. No more empty venues or out-of-pocket losses.', img: 'https://randomuser.me/api/portraits/men/76.jpg' },
  { name: 'Sofia Reyes', role: 'NTU · Year 1', quote: 'Refunds went straight back to my wallet when an event fell through. It just works — I never worry about losing my money.', img: 'https://randomuser.me/api/portraits/women/68.jpg' },
  { name: 'Daniel Ong', role: 'Student Club President', quote: 'Inviting co-organisers and checking people in with QR codes made our fundraiser run itself. Highly recommend for any campus club.', img: 'https://randomuser.me/api/portraits/men/12.jpg' },
];

export function TestimonialsCarousel() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = TESTIMONIALS.length;
  const next = () => setI((c) => (c + 1) % n);
  const prev = () => setI((c) => (c - 1 + n) % n);

  useEffect(() => {
    if (paused) return undefined;
    const t = setInterval(() => setI((c) => (c + 1) % n), 4000);
    return () => clearInterval(t);
  }, [n, paused]);

  const t = TESTIMONIALS[i];
  const arrowBtn = 'grid size-9 place-items-center rounded-full border transition hover:bg-white/5';

  return (
    <section
      className="my-12 rounded-2xl border px-4 py-10"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <h2 className="text-center" style={{ color: GOLD, fontWeight: 700, fontSize: 22, letterSpacing: '0.04em' }}>WHAT STUDENTS SAY</h2>
      <div className="mx-auto mt-3 mb-8 h-px w-16" style={{ background: GOLD }} />

      <div className="mx-auto flex max-w-3xl items-center gap-3 sm:gap-6">
        <button onClick={prev} aria-label="Previous" className={arrowBtn} style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
          <ChevronLeft size={18} />
        </button>

        <div className="min-h-[13rem] flex-1 text-center">
          <img
            src={t.img}
            alt={t.name}
            className="mx-auto mb-4 size-20 rounded-full object-cover"
            style={{ border: `2px solid ${GOLD}` }}
          />
          <p className="mx-auto max-w-xl text-base" style={{ color: 'var(--foreground)', lineHeight: 1.6 }}>
            &ldquo;{t.quote}&rdquo;
          </p>
          <p className="mt-4" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{t.name}</p>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{t.role}</p>
        </div>

        <button onClick={next} aria-label="Next" className={arrowBtn} style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mt-6 flex justify-center gap-2">
        {TESTIMONIALS.map((_, idx) => (
          <button
            key={idx}
            onClick={() => setI(idx)}
            aria-label={`Go to testimonial ${idx + 1}`}
            className="size-2 rounded-full transition"
            style={{ background: idx === i ? GOLD : 'var(--border)' }}
          />
        ))}
      </div>
    </section>
  );
}
