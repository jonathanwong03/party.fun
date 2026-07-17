import { useEffect, useState } from 'react';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { ChevronLeft, Wallet as WalletIcon, CreditCard, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { stripePromise, stripeConfigured } from '../stripe';
import { fetchWallet, createSetupIntent, saveCard, topUpWallet, type WalletInfo } from '../api';
import type { Route } from '../components/types';

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const MAX_TOPUP = 200; // per-transaction cap; the backend enforces the authoritative limit too.
const CARD_STYLE = { style: { base: { fontSize: '16px', color: '#f5f5f7', '::placeholder': { color: '#8a8a99' } }, invalid: { color: '#ff6b6b' } } };

export function WalletPage({ go, onBalance }: { go: (r: Route) => void; onBalance?: (n: number) => void }) {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const w = await fetchWallet();
    setWallet(w);
    onBalance?.(w.balance);
  };
  useEffect(() => { refresh().catch(() => {}).finally(() => setLoading(false)); }, []);

  return (
    <div className="mx-auto max-w-[860px] px-6 py-8">
      <button onClick={() => go({ name: 'landing' })} className="mb-4 inline-flex items-center gap-1 text-sm hover:text-foreground" style={{ color: 'var(--muted-foreground)' }}>
        <ChevronLeft size={14} /> Back to events
      </button>
      <h1 className="mb-6" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>Wallet</h1>

      {/* Balance */}
      <div className="mb-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted-foreground)' }}><WalletIcon size={15} /> Balance</div>
        <div className="mt-1" style={{ fontSize: 36, fontWeight: 800 }}>{loading ? '—' : money(wallet?.balance ?? 0)}</div>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>Use your wallet to pledge instantly; top it up with your linked card.</p>
      </div>

      {!stripeConfigured && (
        <div className="mb-6 rounded-xl p-4 text-sm" style={{ background: 'rgba(255,203,60,0.10)', border: '1px solid rgba(255,203,60,0.35)', color: '#ffd968' }}>
          Card features are disabled — set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in <code>frontend/.env</code> and restart Vite.
        </div>
      )}

      {stripeConfigured && (
        <Elements stripe={stripePromise}>
          <CardSection wallet={wallet} onChange={refresh} />
          <TopUpSection hasCard={!!wallet?.card} onChange={refresh} />
        </Elements>
      )}

      {/* History */}
      <div className="rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}><h3>Transactions</h3></div>
        {(wallet?.transactions ?? []).length === 0 ? (
          <div className="px-5 py-10 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>No transactions yet.</div>
        ) : (
          <div>
            {wallet!.transactions.map((t) => {
              const credit = t.type === 'topup' || t.type === 'refund' || t.type === 'signup_bonus';
              const label = t.type === 'signup_bonus' ? 'Signup bonus' : t.type;
              return (
                <div key={t.id} className="flex items-center justify-between border-t px-5 py-3 text-sm" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{label}</div>
                    <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{new Date(t.createdAt).toLocaleString('en-SG')} · {t.source}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: credit ? '#29e07a' : 'var(--foreground)' }}>{credit ? '+' : '−'}{money(t.amount)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CardSection({ wallet, onChange }: { wallet: WalletInfo | null; onChange: () => Promise<void> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      const { clientSecret } = await createSetupIntent();
      const result = await stripe.confirmCardSetup(clientSecret, { payment_method: { card } });
      if (result.error) throw new Error(result.error.message || 'Could not save card.');
      const pmId = result.setupIntent?.payment_method as string;
      await saveCard(pmId);
      setOpen(false);
      card.clear();
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save card.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted-foreground)' }}><CreditCard size={15} /> Linked card</div>
        <Button variant="outline" className="border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 9999, height: 36 }} onClick={() => setOpen((v) => !v)}>
          {wallet?.card ? 'Replace card' : 'Link a card'}
        </Button>
      </div>
      <div className="mt-2" style={{ fontWeight: 600 }}>
        {wallet?.card ? `${(wallet.card.brand ?? 'Card')} •••• ${wallet.card.last4}` : 'No card linked'}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <CardElement options={CARD_STYLE} />
          </div>
          {error && <p className="text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
          <Button onClick={submit} disabled={busy || !stripe} className="bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 10, height: 42 }}>
            {busy ? 'Saving…' : 'Save card'}
          </Button>
          {import.meta.env.DEV && (
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Test card: 4242 4242 4242 4242 · any future expiry · any CVC.</p>
          )}
        </div>
      )}
    </div>
  );
}

function TopUpSection({ hasCard, onChange }: { hasCard: boolean; onChange: () => Promise<void> }) {
  const [amount, setAmount] = useState('20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // One idempotency key per top-up. A double-click reuses it (Stripe dedups to a single charge);
  // a fresh key is minted only after a successful top-up, so the next intentional one is distinct.
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());

  const submit = async () => {
    const value = Number(amount);
    if (!value || value <= 0) { setError('Enter a valid amount.'); return; }
    if (value > MAX_TOPUP) { setError(`Top-ups are capped at ${money(MAX_TOPUP)} per transaction.`); return; }
    setBusy(true); setError(null); setOk(false);
    try {
      await topUpWallet(value, attemptId);
      setAttemptId(crypto.randomUUID());
      setOk(true);
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Top-up failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted-foreground)' }}><Plus size={15} /> Top up</div>
      {!hasCard ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>Link a card above to top up your wallet.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>Amount (SGD)</Label>
            <Input value={amount} inputMode="decimal" onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setOk(false); }} style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', height: 42, width: 160 }} />
            <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>Up to {money(MAX_TOPUP)} per transaction.</p>
          </div>
          <Button onClick={submit} disabled={busy} className="bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 10, height: 42 }}>
            {busy ? 'Charging…' : 'Top up'}
          </Button>
        </div>
      )}
      {error && <p className="mt-3 text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
      {ok && <p className="mt-3 text-xs" style={{ color: '#29e07a', fontWeight: 600 }}>Wallet topped up.</p>}
    </div>
  );
}
