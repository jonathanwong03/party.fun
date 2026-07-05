import { useState } from 'react';
import { Plus, Minus, ArrowLeft } from 'lucide-react';
import type { Route } from '../components/types';

const GOLD = '#d4a24e';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is party.fun and how does it work?',
    a: 'party.fun is a campus events platform. Organisers create events and students pledge for tickets. An event only becomes confirmed ("greenlit") once enough tickets are pledged to reach its hype threshold — so organisers can gauge real demand before committing.',
  },
  {
    q: 'Do I pay when I pledge, or only if the event happens?',
    a: 'Payment is captured at the moment you pledge — it is not an unpaid RSVP. If the event is later cancelled or misses its hype threshold by the deadline, every backer is refunded in full.',
  },
  {
    q: 'How do refunds work?',
    a: 'Refunds go back the way you paid: wallet-paid pledges are returned instantly to your in-app wallet, and card-paid pledges are refunded to your original card via Stripe. Refunds happen automatically when an event is cancelled or misses its threshold.',
  },
  {
    q: 'What is the in-app wallet?',
    a: 'Every account has a wallet. You can top it up (charged to your linked card), pay for tickets from the balance, and receive refunds and organiser payouts straight to it. You can also pay by card at checkout instead of the wallet.',
  },
  {
    q: 'Can I give away tickets I no longer need?',
    a: 'Yes. You can give away some or all of the tickets you hold for an event. Give-aways are final and non-refundable — the money you paid still counts as spend, and the released spots return to the public pool for others to buy.',
  },
  {
    q: 'How do I host an event?',
    a: 'Organisers use Create Event to start an event, which is first saved as a draft to review. Once published it collects pledges. You set the schedule, pledging deadline, capacity, hype threshold, and pricing — and can invite co-organisers to help manage it.',
  },
  {
    q: 'What is the difference between tiered and hype pricing?',
    a: 'Tiered pricing has a fixed early-bird price until the early allocation sells out, then a fixed greenlit price — simple and predictable. Hype pricing rises from a base price toward a max price as more tickets sell, rewarding early buyers. The pricing model is locked once the event is created.',
  },
  {
    q: 'What are university-restricted events and co-organisers?',
    a: 'Organisers can restrict an event to their own university, so only eligible students see and join it. Co-organisers are other organiser accounts invited to help manage a specific event — they can edit it, view attendees and check in tickets, but only the owner can cancel, delete, or invite.',
  },
];

function FaqItem({ index, q, a, open, onToggle }: { index: number; q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b" style={{ borderColor: 'var(--border)' }}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 py-5 text-left transition"
        aria-expanded={open}
      >
        <span style={{ color: GOLD, fontWeight: 700, fontSize: 18, width: 28, flexShrink: 0 }}>{index}.</span>
        <span className="flex-1" style={{ color: 'var(--foreground)', fontWeight: 700, fontSize: 17 }}>{q}</span>
        {open ? <Minus size={20} style={{ color: GOLD, flexShrink: 0 }} /> : <Plus size={20} style={{ color: GOLD, flexShrink: 0 }} />}
      </button>
      {open && (
        <div className="pb-5 pl-11 pr-8 text-sm" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
          {a}
        </div>
      )}
    </div>
  );
}

export function FAQ({ go }: { go: (r: Route) => void }) {
  const [openIdx, setOpenIdx] = useState<number>(0); // first one open, like the reference

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <button onClick={() => go({ name: 'landing' })} className="mb-6 inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted-foreground)' }}>
        <ArrowLeft size={16} /> Back to events
      </button>
      <div className="rounded-2xl border p-6 sm:p-8" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <h1 className="text-center" style={{ color: GOLD, fontWeight: 700, fontSize: 26, letterSpacing: '0.02em' }}>
          COMMONLY ASKED QUESTIONS
        </h1>
        <div className="mx-auto mt-3 mb-6 h-px w-16" style={{ background: GOLD }} />
        <div>
          {FAQS.map((f, i) => (
            <FaqItem
              key={i}
              index={i + 1}
              q={f.q}
              a={f.a}
              open={openIdx === i}
              onToggle={() => setOpenIdx((cur) => (cur === i ? -1 : i))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
