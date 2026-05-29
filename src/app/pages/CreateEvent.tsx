import { useState } from 'react';
import { ChevronLeft, Image as ImageIcon, AlertTriangle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { HypeMeter } from '../components/HypeMeter';
import { StatusBadge } from '../components/StatusBadge';
import { DeleteEventModal } from '../components/DeleteEventModal';
import { MOCK_EVENTS, type Route, type EventStatus } from '../components/types';
import { NumberStepper } from '../components/NumberStepper';

export function CreateEvent({ route, go, editId }: { route: Route; go: (r: Route) => void; editId?: string }) {
  const existing = editId ? MOCK_EVENTS.find((e) => e.id === editId) : undefined;
  const isEdit = !!existing;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [venue, setVenue] = useState(existing?.location.split(',')[0] ?? '');
  const [address, setAddress] = useState(existing?.location ?? '');
  const [date, setDate] = useState(existing?.date ?? '');
  const [start, setStart] = useState(existing?.time ?? '');
  const [end, setEnd] = useState('');
  const [capacity, setCapacity] = useState<number>(existing?.capacity ?? 300);
  const [threshold, setThreshold] = useState<number>(existing?.threshold ?? 150);
  const [deadline, setDeadline] = useState(existing?.deadline ?? '');
  const [t1p, setT1p] = useState<number>(existing?.tiers[0]?.price ?? 10);
  const [t1q, setT1q] = useState<number>(existing?.tiers[0]?.qty ?? 50);
  const [t2p, setT2p] = useState<number>(existing?.tiers[1]?.price ?? 15);
  const [t2q, setT2q] = useState<number>(existing?.tiers[1]?.qty ?? 80);
  const [t3p, setT3p] = useState<number>(existing?.tiers[2]?.price ?? 22);
  const [t3q, setT3q] = useState<number>(existing?.tiers[2]?.qty ?? 100);
  const [tFp, setTFp] = useState<number>(existing?.tiers[3]?.price ?? 28);
  const [deleting, setDeleting] = useState(false);

  const status: EventStatus = existing?.status ?? 'live';
  const locked = isEdit && status === 'greenlit';

  return (
    <div>
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-6xl">
          <button
            onClick={() => go({ name: 'admin' })}
            className="mb-4 inline-flex items-center gap-1 text-sm hover:text-foreground"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <ChevronLeft size={14} /> Back to dashboard
          </button>

          <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>
                {isEdit ? 'Edit event' : 'Create new event'}
              </h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                {isEdit ? 'Update the details below. Changes are visible to backers immediately.' : 'Set up your event details, threshold and pricing tiers.'}
              </p>
            </div>
            {isEdit && <div className="flex items-center gap-3"><span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Status</span><StatusBadge status={status} /></div>}
          </div>

          {isEdit && (status === 'live' || status === 'almost') && (
            <div className="mb-6 flex items-start gap-2 rounded-xl p-4 text-sm"
              style={{ background: 'rgba(255,203,60,0.10)', border: '1px solid rgba(255,203,60,0.35)', color: '#ffd968' }}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <div style={{ fontWeight: 700 }}>This event is live</div>
                <div className="opacity-90">Editing pricing or threshold while backers are pledging may impact trust. Changes are logged.</div>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <Section title="Basic details">
                <Field label="Event title">
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Neon Jungle: Freshers Rave" style={fieldStyle} />
                </Field>
                <Field label="Description">
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the vibe?" rows={4} style={fieldStyle} />
                </Field>
                <Field label="Event image / banner">
                  <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-dashed p-4 text-left text-sm hover:bg-white/5"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--muted-foreground)' }}>
                    <ImageIcon size={18} />
                    <span>Drag & drop or click to upload (16:9 recommended)</span>
                  </button>
                </Field>
              </Section>

              <Section title="Schedule">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Date"><Input type="text" value={date} onChange={(e) => setDate(e.target.value)} placeholder="Fri, Jun 12" style={fieldStyle} /></Field>
                  <Field label="Start time"><Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="10:00 PM" style={fieldStyle} /></Field>
                  <Field label="End time"><Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="2:00 AM" style={fieldStyle} /></Field>
                </div>
              </Section>

              <Section title="Location">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Venue name"><Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="The Projector" style={fieldStyle} /></Field>
                  <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Golden Mile Tower" style={fieldStyle} /></Field>
                </div>
              </Section>

              <Section title="Capacity & threshold">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Max capacity"><NumberStepper value={capacity} onChange={setCapacity} min={1} /></Field>
                  <Field label={`Minimum hype threshold (${threshold} backers)`}>
                    <NumberStepper value={threshold} onChange={setThreshold} min={1} disabled={locked} />
                  </Field>
                </div>
              </Section>

              <Section title="Pricing tiers (bonding curve)">
                {locked && (
                  <div className="mb-3 rounded-lg p-2 text-xs" style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)', color: '#a6f3c8' }}>
                    Pricing is locked — this event is greenlit.
                  </div>
                )}
                <TierRow label="Tier 1 — Super Early" price={t1p} qty={t1q} onPrice={setT1p} onQty={setT1q} disabled={locked} />
                <TierRow label="Tier 2 — Early" price={t2p} qty={t2q} onPrice={setT2p} onQty={setT2q} disabled={locked} />
                <TierRow label="Tier 3 — Standard" price={t3p} qty={t3q} onPrice={setT3p} onQty={setT3q} disabled={locked} />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Greenlit / door price"><NumberStepper value={tFp} onChange={setTFp} min={0} disabled={locked} /></Field>
                  <Field label="Deadline to reach threshold"><Input value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="Jun 10, 11:59 PM" style={fieldStyle} /></Field>
                </div>
              </Section>

              <div className="flex flex-wrap gap-3 pt-2">
                {isEdit ? (
                  <>
                    <Button className="bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 10, height: 44 }} onClick={() => go({ name: 'admin' })}>
                      Save Changes
                    </Button>
                    <Button variant="outline" className="border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 10, height: 44 }} onClick={() => go({ name: 'admin' })}>
                      Cancel
                    </Button>
                    <Button onClick={() => setDeleting(true)} className="ml-auto bg-[#ff3354] text-white hover:bg-[#ff4865]" style={{ borderRadius: 10, height: 44 }}>
                      Delete Event
                    </Button>
                  </>
                ) : (
                  <>
                    <Button className="bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 10, height: 44 }} onClick={() => go({ name: 'admin' })}>
                      Publish Event
                    </Button>
                    <Button variant="outline" className="border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 10, height: 44 }}>
                      Save Draft
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Preview */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="mb-3 text-xs uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>Preview</div>
                <div className="overflow-hidden rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <div className="grid h-32 place-items-center" style={{ background: 'linear-gradient(135deg, rgba(255,77,46,0.4), rgba(255,203,60,0.3))' }}>
                    <ImageIcon size={28} style={{ color: 'rgba(255,255,255,0.6)' }} />
                  </div>
                  <div className="space-y-3 p-4">
                    <h3 className="line-clamp-2">{title || 'Your event title'}</h3>
                    <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {date || 'Date'} · {venue || 'Venue'}
                    </div>
                    <HypeMeter pct={isEdit ? (existing?.hypePct ?? 0) : 0} status={status} tier={0} size="sm" />
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>From</span>
                      <span style={{ fontWeight: 700 }}>${t1p}</span>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {deleting && existing && (
        <DeleteEventModal
          eventName={existing.title}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            go({ name: 'admin' });
          }}
        />
      )}
    </div>
  );
}

const fieldStyle: React.CSSProperties = { background: 'var(--surface-2)', borderColor: 'var(--border)', height: 42 };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h3 className="mb-4">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>{label}</Label>
      {children}
    </div>
  );
}

function TierRow({ label, price, qty, onPrice, onQty, disabled }: { label: string; price: number; qty: number; onPrice: (n: number) => void; onQty: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_120px_120px] items-end gap-3">
      <div className="text-sm" style={{ color: 'var(--foreground)', fontWeight: 500 }}>{label}</div>
      <Field label="Price ($)">
        <NumberStepper value={price} onChange={onPrice} min={0} disabled={disabled} />
      </Field>
      <Field label="Quantity">
        <NumberStepper value={qty} onChange={onQty} min={0} disabled={disabled} />
      </Field>
    </div>
  );
}
