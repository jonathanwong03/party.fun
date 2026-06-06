import { useEffect, useState } from 'react';
import { ChevronLeft, Shield, CreditCard } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { HypeMeter } from '../components/HypeMeter';
import { StatusBadge } from '../components/StatusBadge';
import { getActiveTier, tierStageLabel, type EventItem, type Role, type Route } from '../components/types';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { fetchQuote, type Quote } from '../api';
import { MonthYearPicker } from '../components/MonthYearPicker';
import { required, emailError, cardError, expiryError, cvcError, matricError } from '../components/validation';

export function Checkout({ id, role, go, events, qty = 1, onPledge }: { id: string; role: Role; go: (r: Route) => void; events: EventItem[]; qty?: number; onPledge: (eventId: string, qty: number, amount: number) => Promise<void> }) {
  const event = events.find((e) => e.id === id);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: 'Jamie Tan',
    email: 'jamie@u.nus.edu',
    phone: '@jamiet',
    matric: '',
    card: '',
    expiry: '',
    cvc: '',
  });
  const [attempted, setAttempted] = useState(false);

  // The backend computes subtotal/fee/total; the frontend only displays them.
  useEffect(() => {
    let ignore = false;
    fetchQuote(role, id, qty)
      .then((q) => { if (!ignore) setQuote(q); })
      .catch(() => { if (!ignore) setQuote(null); });
    return () => { ignore = true; };
  }, [role, id, qty]);

  if (!event) {
    return (
      <div className="mx-auto max-w-[1536px] px-6 py-20 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Loading checkout...
      </div>
    );
  }
  const money = (n: number) => `$${n.toFixed(2)}`;

  // Phone / Telegram is the only optional field; everything else is required.
  const errs = {
    fullName: required(form.fullName),
    email: emailError(form.email),
    matric: matricError(form.matric),
    card: cardError(form.card),
    expiry: expiryError(form.expiry),
    cvc: cvcError(form.cvc),
  };
  const hasErr = Object.values(errs).some(Boolean);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleConfirm = async () => {
    setAttempted(true);
    setSubmitError(null);
    if (hasErr) return;
    try {
      setSubmitting(true);
      await onPledge(event.id, qty, event.price);
      go({ name: 'confirmation', id, qty });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to confirm pledge.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-8">
      <button
        onClick={() => go({ name: 'event', id })}
        className="mb-4 inline-flex items-center gap-1 text-sm hover:text-foreground"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <ChevronLeft size={14} /> Back to event
      </button>

      <h1 className="mb-6" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
        Checkout
      </h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Form */}
        <div className="space-y-6">
          <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <h3 className="mb-4">Tickets</h3>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Current tier</div>
                <div style={{ fontWeight: 600 }}>{tierStageLabel(event)}</div>
              </div>
              <div className="text-right">
                <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Quantity</div>
                <div style={{ fontWeight: 600 }}>{qty} ticket{qty === 1 ? '' : 's'}</div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <h3 className="mb-4">Buyer details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" placeholder="Jamie Tan" value={form.fullName} onChange={set('fullName')} error={attempted ? errs.fullName : null} />
              <Field label="Email" placeholder="you@u.nus.edu" type="email" value={form.email} onChange={set('email')} error={attempted ? errs.email : null} />
              <Field label="Phone / Telegram (optional)" placeholder="@yourhandle" value={form.phone} onChange={set('phone')} />
              <Field label="Matric / Student ID" placeholder="A0234567X" value={form.matric} onChange={set('matric')} error={attempted ? errs.matric : null} />
            </div>
          </section>

          <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <h3 className="mb-4 flex items-center gap-2"><CreditCard size={16} /> Payment</h3>
            <div className="space-y-4">
              <Field label="Card number" placeholder="4242 4242 4242 4242" value={form.card} onChange={set('card')} error={attempted ? errs.card : null} />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Expiry</Label>
                  <MonthYearPicker value={form.expiry} onChange={(v) => setForm((p) => ({ ...p, expiry: v }))} error={!!(attempted && errs.expiry)} />
                  {attempted && errs.expiry && <p className="mt-1 text-xs" style={{ color: '#ff9a82' }}>{errs.expiry}</p>}
                </div>
                <Field label="CVC" placeholder="123" value={form.cvc} onChange={set('cvc')} error={attempted ? errs.cvc : null} />
              </div>
            </div>
          </section>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="relative h-32">
              <ImageWithFallback src={event.image} alt={event.title} className="size-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#14141b] to-transparent" />
              <div className="absolute left-3 top-3"><StatusBadge event={event} /></div>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <h3 className="line-clamp-2">{event.title}</h3>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{event.date} · {event.time}</div>
              </div>

              <HypeMeter pct={event.hypePercentage} status={event.status} tier={getActiveTier(event)} size="sm" />

              <div className="h-px" style={{ background: 'var(--border)' }} />

              <div className="space-y-1.5 text-sm">
                {quote
                  ? quote.lines.map((l) => (
                      <Row key={l.label} label={`${l.label} × ${l.count}`} value={money(l.price * l.count)} />
                    ))
                  : <Row label={`Ticket × ${qty}`} value="—" />}
              </div>
              <div className="flex items-baseline justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <span style={{ color: 'var(--muted-foreground)' }} className="text-sm">Total</span>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{quote ? money(quote.total) : '—'}</span>
              </div>

              <Button
                onClick={handleConfirm}
                disabled={submitting}
                className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647]"
                style={{ borderRadius: 12, height: 48 }}
              >
                {submitting ? 'Confirming...' : 'Confirm Pledge'}
              </Button>

              {(attempted && hasErr) || submitError ? (
                <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(255,77,46,0.08)', border: '1px solid rgba(255,77,46,0.25)', color: '#ff9a82' }}>
                  {submitError || 'Please fill in all required details before confirming your pledge.'}
                </div>
              ) : null}

              <div className="flex items-start gap-2 rounded-lg p-3 text-xs"
                style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)', color: '#a6f3c8' }}>
                <Shield size={14} className="mt-0.5 shrink-0" />
                <span>Your payment is captured now. If the event misses its hype threshold, active tickets are refunded automatically.</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, error, ...props }: { label: string; error?: string | null } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>{label}</Label>
      <Input {...props} style={{ background: 'var(--surface-2)', borderColor: error ? '#ff4d2e' : 'var(--border)', height: 42 }} />
      {error && <p className="mt-1 text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'var(--muted-foreground)' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
