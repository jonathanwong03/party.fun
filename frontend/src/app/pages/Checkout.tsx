import { useEffect, useState } from 'react';
import { ChevronLeft, Shield, Wallet as WalletIcon, CreditCard } from 'lucide-react';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { StatusBadge } from '../components/StatusBadge';
import { getActiveStatus, type EventItem, type Role, type Route } from '../components/types';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { fetchQuote, fetchWallet, type Quote, type WalletInfo } from '../api';
import { DEFAULT_EVENT_IMAGE } from '../components/media';

export function Checkout({ id, role, go, events, qty = 1, onPledge }: { id: string; role: Role; go: (r: Route) => void; events: EventItem[]; qty?: number; onPledge: (eventId: string, qty: number, amount: number, paymentMethod?: 'wallet' | 'card', attemptId?: string) => Promise<string | undefined> }) {
  const event = events.find((e) => e.id === id);
  // One idempotency key per checkout (event+qty). Manual retries reuse it (no double charge);
  // changing the quantity starts a fresh key since it's a different charge.
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());
  useEffect(() => { setAttemptId(crypto.randomUUID()); }, [id, qty]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [method, setMethod] = useState<'wallet' | 'card'>('wallet');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Don't surface "Link a card" / "Not enough balance" until the wallet has actually loaded,
  // otherwise the default-empty state flashes for ~0.5s before fetchWallet resolves.
  const [walletLoaded, setWalletLoaded] = useState(false);

  useEffect(() => {
    let ignore = false;
    setWalletLoaded(false);
    fetchQuote(role, id, qty).then((q) => { if (!ignore) setQuote(q); }).catch(() => { if (!ignore) setQuote(null); });
    fetchWallet()
      .then((w) => { if (!ignore) setWallet(w); })
      .catch(() => { if (!ignore) setWallet(null); })
      .finally(() => { if (!ignore) setWalletLoaded(true); });
    return () => { ignore = true; };
  }, [role, id, qty]);

  if (!event) {
    return (
      <div className="mx-auto max-w-[1536px] px-6 py-20 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Loading checkout...
      </div>
    );
  }

  const total = quote?.total ?? 0;
  const payable = quote?.grandTotal ?? total;   // ticket total + 9% GST
  const balance = wallet?.balance ?? 0;
  const hasCard = !!wallet?.card;
  const walletShort = balance < payable;
  // University-restricted event the signed-in user can't attend — block the pledge (server enforces too).
  const universityBlocked = !!event.restrictedUniversity && event.canAttendUniversity === false;
  const canPay = !universityBlocked && (method === 'wallet' ? !walletShort : hasCard);

  const handleConfirm = async () => {
    setSubmitError(null);
    if (!canPay) return;
    try {
      setSubmitting(true);
      const reference = await onPledge(event.id, qty, total, method, attemptId);
      go({ name: 'confirmation', id, qty, lines: quote?.lines, reference });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to confirm pledge.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1536px] px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={() => go({ name: 'event', id })} className="mb-4 inline-flex items-center gap-1 text-sm hover:text-foreground" style={{ color: 'var(--muted-foreground)' }}>
        <ChevronLeft size={14} /> Back to event
      </button>

      <h1 className="mb-6 text-[24px] sm:text-[32px]" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>Checkout</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Payment source */}
        <div className="space-y-6">
          <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <h3 className="mb-4">Pay with</h3>
            <div className="space-y-3">
              {/* Wallet */}
              <PaySource
                active={method === 'wallet'}
                onClick={() => setMethod('wallet')}
                icon={<WalletIcon size={18} />}
                title="In-app wallet"
                subtitle={walletLoaded ? `Balance: $${balance.toFixed(2)}` : 'Checking…'}
                warn={walletLoaded && walletShort ? 'Not enough balance' : null}
              />
              {method === 'wallet' && walletLoaded && walletShort && (
                <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(255,203,60,0.10)', border: '1px solid rgba(255,203,60,0.35)', color: '#ffd968' }}>
                  Your wallet is short by ${(total - balance).toFixed(2)}.{' '}
                  <button onClick={() => go({ name: 'wallet' })} className="underline" style={{ fontWeight: 700 }}>Top up</button> or pay by card.
                </div>
              )}
              {/* Card */}
              <PaySource
                active={method === 'card'}
                onClick={() => setMethod('card')}
                icon={<CreditCard size={18} />}
                title="Debit / credit card"
                subtitle={hasCard ? `${wallet!.card!.brand ?? 'Card'} •••• ${wallet!.card!.last4}` : walletLoaded ? 'No card linked' : 'Checking…'}
                warn={walletLoaded && !hasCard ? 'Link a card' : null}
              />
              {method === 'card' && walletLoaded && !hasCard && (
                <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(255,203,60,0.10)', border: '1px solid rgba(255,203,60,0.35)', color: '#ffd968' }}>
                  You haven't linked a card.{' '}
                  <button onClick={() => go({ name: 'wallet' })} className="underline" style={{ fontWeight: 700 }}>Link a card</button> in your wallet first.
                </div>
              )}
            </div>
          </section>

          <div className="flex items-start gap-2 rounded-lg p-3 text-xs" style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)', color: '#a6f3c8' }}>
            <Shield size={14} className="mt-0.5 shrink-0" />
            <span>Paid instantly. If the event is cancelled or misses its threshold, you're refunded automatically — wallet payments to your wallet instantly, card payments back to your card (~3–5 business days).</span>
          </div>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="relative h-32">
              <ImageWithFallback src={event.image || DEFAULT_EVENT_IMAGE} alt={event.title} className="size-full object-cover" />
              {!event.image && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.28)' }} />}
              <div className="absolute inset-0 bg-gradient-to-t from-[#14141b] to-transparent" />
              <div className="absolute left-3 top-3"><StatusBadge event={event} /></div>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <h3 className="line-clamp-2">{event.title}</h3>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{event.date} · {event.time}</div>
              </div>
              <HypeMeter pct={event.hypePercentage} status={event.status} statusIndex={getActiveStatus(event)} size="sm" />
              <div className="h-px" style={{ background: 'var(--border)' }} />
              <div className="space-y-1.5 text-sm">
                {quote?.pricingModel === 'hype_driven' && (
                  <p className="text-xs" style={{ color: '#ff8a66' }}>Bonding-curve pricing — each ticket priced along the live curve.</p>
                )}
                {quote ? quote.lines.map((l) => (<Row key={l.label} label={`${l.label} × ${l.count}`} value={l.subtotalText} />)) : <Row label={`Ticket × ${qty}`} value="—" />}
                {quote && <Row label="Subtotal" value={quote.totalText} />}
                {quote && <Row label="GST (9%)" value={quote.gstText} />}
              </div>
              <div className="flex items-baseline justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <span style={{ color: 'var(--muted-foreground)' }} className="text-sm">Total payable</span>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{quote ? quote.grandTotalText : '—'}</span>
              </div>

              {universityBlocked && (
                <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(255,51,84,0.08)', border: '1px solid rgba(255,51,84,0.4)', color: '#ff6b85' }}>
                  This event is open to {event.restrictedUniversity} members only.
                </div>
              )}

              <Button onClick={handleConfirm} disabled={submitting || !canPay || !quote} className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647] disabled:opacity-50" style={{ borderRadius: 12, height: 48 }}>
                {submitting ? 'Processing…' : universityBlocked ? `${event.restrictedUniversity} members only` : method === 'wallet' ? 'Pay with wallet' : 'Pay with card'}
              </Button>

              {submitError && (
                <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(255,77,46,0.08)', border: '1px solid rgba(255,77,46,0.25)', color: '#ff9a82' }}>{submitError}</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PaySource({ active, onClick, icon, title, subtitle, warn }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string; warn: string | null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border p-4 text-left transition"
      style={{ borderColor: active ? '#ff4d2e' : 'var(--border)', background: active ? 'rgba(255,77,46,0.08)' : 'var(--surface-2)' }}
    >
      <div className="grid size-9 place-items-center rounded-lg" style={{ background: 'var(--surface)', color: active ? '#ff4d2e' : 'var(--muted-foreground)' }}>{icon}</div>
      <div className="flex-1">
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{subtitle}</div>
      </div>
      {warn && <span className="text-xs" style={{ color: '#ffd968', fontWeight: 600 }}>{warn}</span>}
      <span className="grid size-5 place-items-center rounded-full border" style={{ borderColor: active ? '#ff4d2e' : 'var(--border-strong)' }}>
        {active && <span className="size-2.5 rounded-full" style={{ background: '#ff4d2e' }} />}
      </span>
    </button>
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
