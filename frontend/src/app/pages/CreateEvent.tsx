import { useState } from 'react';
import { ChevronLeft, Image as ImageIcon, AlertTriangle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { HypeMeter } from '../components/HypeMeter';
import { StatusBadge } from '../components/StatusBadge';
import { DeleteEventModal } from '../components/DeleteEventModal';
import { getActiveTier, type EventItem, type Route, type EventStatus } from '../components/types';
import { NumberStepper } from '../components/NumberStepper';
import { DatePicker } from '../components/DatePicker';
import { TimePicker } from '../components/TimePicker';
import { required, dateError, timeError, deadlineError, priceError, scheduleError, deadlineEventError, futureDateTimeError } from '../components/validation';

export function CreateEvent({ route, go, editId, events, onPublish, onDelete, onUpdate, draftId, drafts, onSaveDraft, onDeleteDraft }: { route: Route; go: (r: Route) => void; editId?: string; events?: EventItem[]; onPublish?: (e: EventItem) => void; onDelete?: (id: string) => void; onUpdate?: (e: EventItem) => void; draftId?: string; drafts?: EventItem[]; onSaveDraft?: (e: EventItem) => void; onDeleteDraft?: (id: string) => void }) {
  const list = events ?? [];
  const existing = editId ? list.find((e) => e.id === editId) : undefined;
  const draftSource = draftId ? (drafts ?? []).find((d) => d.id === draftId) : undefined;
  const isEdit = !!existing;
  // The record used to pre-fill the form: an existing published event, or a draft being resumed.
  const source = existing ?? draftSource;

  const [title, setTitle] = useState(source?.title ?? '');
  const [organiser, setOrganiser] = useState(source?.organiser ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [venue, setVenue] = useState(source?.location.split(',')[0] ?? '');
  const [address, setAddress] = useState(source?.location ?? '');
  // Prefill the pickers in DD/MM/YYYY + H:MM AM/PM so the validators apply uniformly.
  // Seed/published events carry raw ISO (startsAt/endsAt/deadlineAt); drafts only the display strings.
  const [date, setDate] = useState(isoToDateInput(source?.startsAt) || source?.date || '');
  const [start, setStart] = useState(isoToTimeInput(source?.startsAt) || source?.time || '');
  const [end, setEnd] = useState(isoToTimeInput(source?.endsAt) || source?.endTime || '');
  const [endDate, setEndDate] = useState(isoToDateInput(source?.endsAt) || source?.endDate || '');
  // Deadline is split into a date + time picker; combined into "DD/MM/YYYY, H:MM AM/PM" on submit.
  const dl0 = source?.deadlineAt
    ? { d: isoToDateInput(source.deadlineAt), t: isoToTimeInput(source.deadlineAt) }
    : parseDeadline(source?.deadline);
  const [deadlineDate, setDeadlineDate] = useState(dl0.d);
  const [deadlineTime, setDeadlineTime] = useState(dl0.t);
  const deadline = deadlineDate || deadlineTime ? `${deadlineDate}, ${deadlineTime}` : (source?.deadline ?? '');
  const money = (n?: number) => (n != null ? n.toFixed(2) : '');
  // The Early Birds quantity doubles as the hype threshold; Main Crowd adds the rest of capacity.
  const [ebPrice, setEbPrice] = useState<string>(money(source?.tiers[0]?.price) || '10.00');
  const [ebQty, setEbQty] = useState<number>(source?.tiers[0]?.qty ?? source?.hypeThreshold ?? 150);
  const [mcPrice, setMcPrice] = useState<string>(money(source?.tiers[1]?.price) || '20.00');
  const [mcQty, setMcQty] = useState<number>(source?.tiers[1]?.qty ?? 150);
  const maxCapacity = ebQty + mcQty;
  const [deleting, setDeleting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const status: EventStatus = existing?.status ?? 'pending';
  const locked = isEdit && status === 'greenlit';

  const errs = {
    title: required(title),
    organiser: required(organiser),
    description: required(description),
    date: dateError(date),
    start: timeError(start),
    end: timeError(end),
    schedule: scheduleError(date, start, endDate, end),
    venue: required(venue),
    address: required(address),
    deadline: deadlineError(deadline),
    deadlineVsEvent: deadlineEventError(date, start, deadlineDate, deadlineTime),
    ebP: priceError(ebPrice),
    mcP: priceError(mcPrice),
    startFuture: futureDateTimeError(date, start),
    endFuture: futureDateTimeError(endDate, end),
  };
  // The deadline fields stay relaxed in edit mode (seed deadlines are human-readable; greenlit
  // events lock the deadline anyway). Schedule/date/time checks DO run in edit mode now that the
  // pickers are normalised to DD/MM/YYYY, enforcing future start/end and end-after-start.
  const relaxedInEdit = new Set<keyof typeof errs>(['deadline', 'deadlineVsEvent']);
  const errOf = (k: keyof typeof errs) => (showErrors && !(isEdit && relaxedInEdit.has(k)) ? errs[k] : null);
  const errStyle = (e: string | null): React.CSSProperties => ({ ...fieldStyle, borderColor: e ? '#ff4d2e' : 'var(--border)' });

  const handlePublish = () => {
    setShowErrors(true);
    if (Object.values(errs).some(Boolean)) return;
    const newEvent: EventItem = {
      id: `e${Date.now()}`,
      mine: true,
      title,
      organiser,
      date,
      time: start,
      endTime: end,
      endDate,
      location: `${venue}, ${address}`,
      description,
      image: '',
      price: num(ebPrice),
      tierLabel: 'Early Birds',
      currentTierName: 'early_bird',
      hypePercentage: 0,
      hypeThreshold: ebQty,
      activeTicketCount: 0,
      maxCapacity,
      spotsLeft: maxCapacity,
      status: 'pending',
      deadline,
      tiers: [
        { tierName: 'early_bird', label: 'Early Birds', price: num(ebPrice), qty: ebQty, sold: 0 },
        { tierName: 'main_crowd', label: 'Main Crowd', price: num(mcPrice), qty: mcQty, sold: 0 },
      ],
    };
    onPublish?.(newEvent);
    if (draftId) onDeleteDraft?.(draftId); // publishing a resumed draft removes it from Drafts
    go({ name: 'hosted-events' });
  };

  // Save the in-progress form as a draft — no validation, fields may be partial.
  const handleSaveDraft = () => {
    const draft: EventItem = {
      id: draftId ?? `draft-${Date.now()}`,
      mine: true,
      title: title || 'Untitled draft',
      organiser,
      date,
      time: start,
      endTime: end,
      endDate,
      location: `${venue}, ${address}`,
      description,
      image: '',
      price: num(ebPrice),
      tierLabel: 'Early Birds',
      currentTierName: 'early_bird',
      hypePercentage: 0,
      hypeThreshold: ebQty,
      activeTicketCount: 0,
      maxCapacity,
      spotsLeft: maxCapacity,
      status: 'pending',
      deadline,
      tiers: [
        { tierName: 'early_bird', label: 'Early Birds', price: num(ebPrice), qty: ebQty, sold: 0 },
        { tierName: 'main_crowd', label: 'Main Crowd', price: num(mcPrice), qty: mcQty, sold: 0 },
      ],
    };
    onSaveDraft?.(draft);
    go({ name: 'hosted-events' });
  };

  const handleSave = () => {
    if (!existing) return;
    // Block on any active (non-relaxed) error: text fields plus the enforced schedule/future
    // datetime checks (end after start, start & end in the future).
    setShowErrors(true);
    if ((Object.keys(errs) as (keyof typeof errs)[]).some((k) => errOf(k))) return;
    const tiers = [
      { tierName: 'early_bird' as const, label: 'Early Birds', sold: existing.tiers[0]?.sold ?? 0, price: num(ebPrice), qty: ebQty },
      { tierName: 'main_crowd' as const, label: 'Main Crowd', sold: existing.tiers[1]?.sold ?? 0, price: num(mcPrice), qty: mcQty },
    ];
    const updated: EventItem = {
      ...existing,
      title,
      organiser,
      description,
      location: `${venue}, ${address}`,
      date,
      time: start,
      endTime: end,
      endDate,
      maxCapacity,
      hypeThreshold: ebQty,
      deadline,
      spotsLeft: Math.max(0, maxCapacity - existing.activeTicketCount),
      tiers,
    };
    updated.price = updated.tiers[getActiveTier(updated)].price;
    onUpdate?.(updated);
    go({ name: 'hosted-events' });
  };

  return (
    <div>
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-[1536px]">
          <button
            onClick={() => go({ name: 'hosted-events' })}
            className="mb-4 inline-flex items-center gap-1 text-sm hover:text-foreground"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <ChevronLeft size={14} /> Back to hosted events
          </button>

          <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>
                {isEdit ? 'Edit event' : 'Create new event'}
              </h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                {isEdit ? 'Update the details below. Changes are visible to attendees immediately.' : 'Set up your event details, hype threshold and pricing tiers.'}
              </p>
            </div>
            {isEdit && existing && <div className="flex items-center gap-3"><span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Status</span><StatusBadge event={existing} /></div>}
          </div>

          {isEdit && status === 'pending' && (
            <div className="mb-6 flex items-start gap-2 rounded-xl p-4 text-sm"
              style={{ background: 'rgba(255,203,60,0.10)', border: '1px solid rgba(255,203,60,0.35)', color: '#ffd968' }}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <div style={{ fontWeight: 700 }}>This event is live</div>
                <div className="opacity-90">Editing pricing or the hype threshold while people are pledging may impact trust. Changes are logged.</div>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <Section title="Basic details">
                <Field label="Event title" error={errOf('title')}>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Neon Jungle: Freshers Rave" style={errStyle(errOf('title'))} />
                </Field>
                <Field label="Organiser" error={errOf('organiser')}>
                  <Input value={organiser} onChange={(e) => setOrganiser(e.target.value)} placeholder="NUS Electronic Music Club" style={errStyle(errOf('organiser'))} />
                </Field>
                <Field label="Description" error={errOf('description')}>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the vibe?" rows={4} style={errStyle(errOf('description'))} />
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Start date" error={errOf('date')}><DatePicker value={date} onChange={setDate} error={!!errOf('date')} /></Field>
                  <Field label="Start time" error={errOf('start')}><TimePicker value={start} onChange={setStart} error={!!errOf('start')} placeholder="Start time" /></Field>
                  <Field label="End date" error={errOf('schedule')}><DatePicker value={endDate} onChange={setEndDate} error={!!errOf('schedule')} /></Field>
                  <Field label="End time" error={errOf('end')}><TimePicker value={end} onChange={setEnd} error={!!(errOf('end') || errOf('schedule'))} placeholder="End time" /></Field>
                </div>
              </Section>

              <Section title="Location">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Venue name" error={errOf('venue')}><Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="The Projector" style={errStyle(errOf('venue'))} /></Field>
                  <Field label="Address" error={errOf('address')}><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Golden Mile Tower" style={errStyle(errOf('address'))} /></Field>
                </div>
              </Section>

              <Section title="Pricing tiers">
                {locked && (
                  <div className="mb-3 rounded-lg p-2 text-xs" style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)', color: '#a6f3c8' }}>
                    Pricing is locked — this event is greenlit.
                  </div>
                )}
                <div className="mb-3 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  The Early Birds quantity is the hype threshold — the minimum viable attendance that confirms the event. Tier quantities set the maximum capacity of {maxCapacity}.
                </div>
                <TierRow label="Early Birds - Hype Threshold" price={ebPrice} qty={ebQty} onPrice={setEbPrice} onQty={setEbQty} disabled={locked} error={errOf('ebP')} />
                <TierRow label="Main Crowd" price={mcPrice} qty={mcQty} onPrice={setMcPrice} onQty={setMcQty} disabled={locked} error={errOf('mcP')} />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Deadline date" error={errOf('deadline') || errOf('deadlineVsEvent')}><DatePicker value={deadlineDate} onChange={setDeadlineDate} error={!!(errOf('deadline') || errOf('deadlineVsEvent'))} disabled={locked} /></Field>
                  <Field label="Deadline time"><TimePicker value={deadlineTime} onChange={setDeadlineTime} error={!!errOf('deadline')} placeholder="Deadline time" disabled={locked} /></Field>
                </div>
              </Section>

              <div className="flex flex-wrap gap-3 pt-2">
                {isEdit ? (
                  <>
                    <Button className="bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 10, height: 44 }} onClick={handleSave}>
                      Save Changes
                    </Button>
                    <Button variant="outline" className="border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 10, height: 44 }} onClick={() => go({ name: 'hosted-events' })}>
                      Cancel
                    </Button>
                    <Button onClick={() => setDeleting(true)} className="ml-auto bg-[#ff3354] text-white hover:bg-[#ff4865]" style={{ borderRadius: 10, height: 44 }}>
                      Delete Event
                    </Button>
                  </>
                ) : (
                  <>
                    <Button className="bg-[#ff4d2e] text-white hover:bg-[#ff6647]" style={{ borderRadius: 10, height: 44 }} onClick={handlePublish}>
                      Publish Event
                    </Button>
                    <Button variant="outline" className="border-white/15 bg-transparent hover:bg-white/5" style={{ borderRadius: 10, height: 44 }} onClick={handleSaveDraft}>
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
                    <HypeMeter pct={isEdit ? (existing?.hypePercentage ?? 0) : 0} status={status} tier={0} size="sm" />
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>From</span>
                      <span style={{ fontWeight: 700 }}>${ebPrice}</span>
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
            onDelete?.(existing.id);
            go({ name: 'hosted-events' });
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

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string | null }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs" style={{ color: 'var(--muted-foreground)' }}>{label}</Label>
      {children}
      {error && <p className="mt-1 text-xs" style={{ color: '#ff9a82' }}>{error}</p>}
    </div>
  );
}

function TierRow({ label, price, qty, onPrice, onQty, disabled, error }: { label: string; price: string; qty: number; onPrice: (v: string) => void; onQty: (n: number) => void; disabled?: boolean; error?: string | null }) {
  return (
    <div className="grid grid-cols-[1fr_120px_120px] items-end gap-3">
      <div className="text-sm" style={{ color: 'var(--foreground)', fontWeight: 500 }}>{label}</div>
      <Field label="Price" error={error}>
        <PriceInput value={price} onChange={onPrice} disabled={disabled} error={!!error} />
      </Field>
      <Field label="Quantity">
        <NumberStepper value={qty} onChange={onQty} min={1} disabled={disabled} />
      </Field>
    </div>
  );
}

// $-prefixed price input that only accepts digits, one decimal point and at most 2 decimals.
function PriceInput({ value, onChange, disabled, error }: { value: string; onChange: (v: string) => void; disabled?: boolean; error?: boolean }) {
  const handle = (raw: string) => {
    let v = raw.replace(/[^\d.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = `${parts[0]}.${parts.slice(1).join('')}`;
    const [intPart, dec] = v.split('.');
    onChange(dec !== undefined ? `${intPart}.${dec.slice(0, 2)}` : intPart);
  };
  return (
    <div
      className="flex items-center rounded-md border"
      style={{ background: 'var(--surface-2)', borderColor: error ? '#ff4d2e' : 'var(--border)', height: 42, opacity: disabled ? 0.5 : 1 }}
    >
      <span className="pl-3 pr-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>$</span>
      <input
        value={value}
        onChange={(e) => handle(e.target.value)}
        disabled={disabled}
        inputMode="decimal"
        placeholder="0.00"
        className="h-full w-full bg-transparent pr-3 text-sm outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

const num = (s: string) => parseFloat(s) || 0;

// Format a raw ISO datetime into the picker formats (Asia/Singapore) so the validators,
// which expect DD/MM/YYYY and H:MM AM/PM, apply uniformly to seed/published events.
function isoToDateInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}
function isoToTimeInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toUpperCase();
}

// Split a stored deadline string "DD/MM/YYYY, H:MM AM/PM" into its date + time parts.
// Human-readable seed deadlines (e.g. "Jun 10, 11:59 PM") don't match and yield empty parts.
function parseDeadline(s?: string): { d: string; t: string } {
  const m = /^(\d{1,2}\/\d{1,2}\/\d{4}),?\s*(\d{1,2}:\d{2}\s*(?:AM|PM))$/i.exec((s ?? '').trim());
  return m ? { d: m[1], t: m[2].toUpperCase() } : { d: '', t: '' };
}
