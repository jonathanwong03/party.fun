import { useState } from 'react';
import { Calendar, Clock, MapPin, Shield, ChevronLeft, ArrowRight, Timer, Minus, Plus } from 'lucide-react';
import { Countdown } from '../components/Countdown';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { TicketPricesOverTime } from '../components/TicketPricesOverTime';
import { PricingTier } from '../components/PricingTier';
import { StatusBadge } from '../components/StatusBadge';
import { DeleteEventModal } from '../components/DeleteEventModal';
import { getActiveTier, tierStageLabel, type EventItem, type Role, type Route } from '../components/types';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';

export function EventDetail({ id, go, role, events, qty, amount, total, onCancelAttendance, fromProfile, fromOrganiser, fromPast }: { id: string; go: (r: Route) => void; role: Role | null; events: EventItem[]; qty?: number; amount?: number; total?: number; onCancelAttendance?: (id: string, qty: number, amount: number) => Promise<void>; fromProfile?: boolean; fromOrganiser?: boolean; fromPast?: boolean }) {
  const event = events.find((e) => e.id === id);
  const [cancelling, setCancelling] = useState(false);
  const [buyQty, setBuyQty] = useState(1);
  if (!event) {
    return (
      <div className="mx-auto max-w-[1536px] px-6 py-20 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Loading event...
      </div>
    );
  }
  const activeTier = getActiveTier(event);
  // Total tickets still available across all tiers (a pledge spills into the next tier).
  const available = event.tiers.reduce((sum, t) => sum + Math.max(0, t.qty - t.sold), 0);
  const showCancelledCard = !!fromPast;
  const showOptOut = !!fromProfile;
  const showWhosGoing = !!fromOrganiser;
  // You can't pledge to an event you created yourself — show a notice instead of the Pledge/Buy card.
  const showOwnEvent = !!role && !!event.mine && !showCancelledCard && !showOptOut && !showWhosGoing;

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-8">
      <button
        onClick={() => go({ name: 'landing' })}
        className="mb-4 inline-flex items-center gap-1 text-sm transition hover:text-foreground"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <ChevronLeft size={14} /> Back to events
      </button>

      {/* banner */}
      <div className="relative mb-8 overflow-hidden rounded-3xl">
        <ImageWithFallback src={event.image} alt={event.title} className="h-72 w-full object-cover md:h-96" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0f] via-[#0b0b0f]/30 to-transparent" />
        <div className="absolute inset-x-6 bottom-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <StatusBadge event={event} />
            <h1 className="mt-3 text-white" style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {event.title}
            </h1>
            <p className="mt-1 text-white/70 text-sm">Hosted by {event.organiser}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          {/* meta */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              { icon: Calendar, label: 'Date', value: event.date },
              { icon: Clock, label: 'Time', value: `${event.time}${event.endTime ? ` – ${event.endTime}` : ''}` },
              { icon: MapPin, label: 'Location', value: event.location.split(',')[0] },
            ].map((m) => (
              <div key={m.label} className="rounded-xl glass p-4 transition-all duration-300 hover:scale-[1.02]">
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  <m.icon size={13} /> {m.label}
                </div>
                <div className="mt-1 font-bold text-white">{m.value}</div>
              </div>
            ))}
          </div>

          {/* description */}
          <div>
            <h2 className="mb-3">About this party</h2>
            <p style={{ color: 'var(--muted-foreground)' }}>{event.description}</p>
          </div>

          {/* Hype meter */}
          <div className="rounded-2xl glass p-6 transition-all duration-300">
            <div className="mb-5">
              <TicketPricesOverTime tiers={event.tiers} />
            </div>
            <div className="mb-4 flex items-baseline justify-between">
              <h3>Hype meter</h3>
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Deadline: {event.deadline}</span>
            </div>
            <HypeMeter pct={event.hypePct} status={event.status} tier={activeTier} size="lg" backers={event.backers} threshold={event.threshold} />

            {/* Countdown */}
            {event.status !== 'greenlit' && event.status !== 'cancelled' && (
              <div className="mt-5 rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
                <div className="mb-3 flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  <Timer size={12} /> Hype deadline
                  <span className="ml-auto font-medium" style={{ color: 'var(--foreground)' }}>{event.deadline}</span>
                </div>
                <Countdown deadline={event.deadline} />
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Threshold</div>
                <div className="mt-1" style={{ fontWeight: 700 }}>{event.threshold} </div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Pledged</div>
                <div className="mt-1" style={{ fontWeight: 700 }}>{event.backers}</div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Spots left</div>
                <div className="mt-1" style={{ fontWeight: 700 }}>{event.spotsLeft}</div>
              </div>
            </div>
          </div>

          {/* pricing tiers */}
          <PricingTier tiers={event.tiers} activeIndex={activeTier} />

          {/* how it works */}
          <div className="rounded-2xl glass p-6 transition-all duration-300">
            <h3 className="mb-3">How it works</h3>
            <ol className="space-y-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>
              <li><strong>Buy early</strong> — earlier tiers are cheaper.</li>
              <li><strong>Hit the threshold</strong> — the event is greenlit and the party is on.</li>
              <li><strong>Missed the threshold?</strong> You're automatically refunded in full.</li>
            </ol>
          </div>
        </div>

        {showCancelledCard ? (
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="mb-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{tierStageLabel(event)}</div>
            <div className="flex items-baseline gap-2">
              <span style={{ fontSize: 36, fontWeight: 800 }}>${event.price}</span>
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>per ticket</span>
            </div>

            <div className="my-5 h-px" style={{ background: 'var(--border)' }} />

            <Button
              disabled
              className="w-full"
              style={{ background: '#5c2a20', color: 'rgba(255,255,255,0.55)', borderRadius: 12, height: 52, fontSize: 16, fontWeight: 700 }}
            >
              Event over
            </Button>

            <div className="mt-5 rounded-lg p-3" style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: '#a6f3c8' }}>
                <Shield size={14} className="mt-0.5 shrink-0" />
                <span>Funds are only captured when the event hits its hype threshold. If it doesn't, you're refunded automatically.</span>
              </div>
            </div>
          </div>
        </aside>
        ) : showOptOut ? (
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl glass p-6 transition-all duration-300">
            <div className="mb-1 text-xs uppercase tracking-wider" style={{ color: '#29e07a' }}>You're in</div>
            <h3 className="mt-1" style={{ fontSize: 22, fontWeight: 700 }}>Pledge confirmed</h3>
            <div className="mt-1 text-sm" style={{ color: 'var(--foreground)', fontWeight: 600 }}>
              {(qty ?? 1)}× ticket{(qty ?? 1) === 1 ? '' : 's'}
            </div>
            <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
              You've pledged <strong style={{ color: 'var(--foreground)' }}>${(total ?? event.price).toFixed(2)}</strong> for this event. If it hits its threshold, your ticket is locked in. If not, you're refunded automatically.
            </p>

            <div className="my-5 h-px" style={{ background: 'var(--border)' }} />

            <Button
              onClick={() => setCancelling(true)}
              className="w-full bg-[#ff0a0a] text-white hover:bg-[#ff2a2a]"
              style={{ borderRadius: 12, height: 52, fontSize: 16, fontWeight: 700 }}
            >
              Cancel Event
            </Button>

            <div className="mt-5 rounded-lg p-3" style={{ background: 'rgba(255,122,147,0.08)', border: '1px solid rgba(255,122,147,0.3)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: '#ff7a93' }}>
                <Shield size={14} className="mt-0.5 shrink-0" />
                <span>Cancelling is final — you will <strong>not</strong> be refunded. Refunds only happen automatically if the event misses its hype threshold by the deadline.</span>
              </div>
            </div>
          </div>
          <WhosGoingCard event={event} />
        </aside>
        ) : showWhosGoing ? (
        <aside className="lg:sticky lg:top-24 lg:self-start" key="whos-going">
          <WhosGoingCard event={event} />
        </aside>
        ) : showOwnEvent ? (
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl glass p-6 transition-all duration-300">
            <div className="mb-1 text-xs uppercase tracking-wider" style={{ color: '#ffd968' }}>Your event</div>
            <h3 className="mt-1" style={{ fontSize: 22, fontWeight: 700 }}>You're the organiser</h3>
            <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
              You can't pledge to your own event. Manage it from your dashboard.
            </p>

            <div className="my-5 h-px" style={{ background: 'var(--border)' }} />

            <Button
              disabled
              className="w-full"
              style={{ background: '#2a2a33', color: 'rgba(255,255,255,0.55)', borderRadius: 12, height: 52, fontSize: 16, fontWeight: 700 }}
            >
              Can't pledge your own event
            </Button>

            <Button
              onClick={() => go({ name: 'hosted-events' })}
              variant="outline"
              className="mt-3 w-full border-white/15 bg-transparent hover:bg-white/5"
              style={{ borderRadius: 12, height: 48, fontSize: 15, fontWeight: 700 }}
            >
              Go to hosted events
            </Button>
          </div>
        </aside>
        ) : (
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl glass p-6 transition-all duration-300 shadow-xl" style={{ border: '1px solid rgba(255, 69, 0, 0.15)' }}>
            <div className="mb-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{tierStageLabel(event)}</div>
            <div className="flex items-baseline gap-2">
              <span style={{ fontSize: 36, fontWeight: 800 }}>${event.price}</span>
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>per ticket</span>
            </div>
            <div className="mt-1 text-xs" style={{ color: '#ffd968' }}>Price rises at the next tier</div>

            {event.status !== 'cancelled' && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Quantity</span>
                  <div className="flex items-center gap-2 rounded-full border p-1" style={{ borderColor: 'var(--border-strong)' }}>
                    <button onClick={() => setBuyQty((q) => Math.max(1, q - 1))} className="grid size-8 place-items-center rounded-full hover:bg-white/5">
                      <Minus size={14} />
                    </button>
                    <span className="w-6 text-center" style={{ fontWeight: 600 }}>{buyQty}</span>
                    <button onClick={() => setBuyQty((q) => Math.min(available, q + 1))} disabled={buyQty >= available} className="grid size-8 place-items-center rounded-full hover:bg-white/5 disabled:opacity-40">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{available} ticket{available === 1 ? '' : 's'} left</div>
              </div>
            )}

            <div className="my-5 h-px" style={{ background: 'var(--border)' }} />

            <Button
              onClick={() => go(role ? { name: 'checkout', id: event.id, qty: buyQty } : { name: 'login' })}
              disabled={event.status === 'cancelled' || available === 0}
              className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647] disabled:opacity-50"
              style={{ borderRadius: 12, height: 52, fontSize: 16, fontWeight: 700 }}
            >
              {event.status === 'greenlit'
                ? `Buy Ticket · $${event.price}`
                : event.status === 'cancelled'
                ? 'Event cancelled'
                : 'Pledge'}
              {event.status !== 'cancelled' && <ArrowRight size={16} className="ml-1" />}
            </Button>

            <div className="mt-5 rounded-lg p-3" style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: '#a6f3c8' }}>
                <Shield size={14} className="mt-0.5 shrink-0" />
                <span>Funds are only captured when the event hits its hype threshold. If it doesn't, you're refunded automatically.</span>
              </div>
            </div>
          </div>
          <WhosGoingCard event={event} />
        </aside>
        )}
      </div>

      {cancelling && (
        <DeleteEventModal
          eventName={event.title}
          confirmWord="CONFIRM"
          title="Cancel Event?"
          leadIn="You're about to cancel your spot for"
          warning="Cancelling is final — you will NOT be refunded. Your spot is released back to the pool and you'll no longer be attending. Refunds only happen if the event misses its hype threshold by the deadline."
          actionLabel="Cancel Event"
          onCancel={() => setCancelling(false)}
          onConfirm={() => {
            setCancelling(false);
            Promise.resolve(onCancelAttendance?.(event.id, qty ?? 1, amount ?? event.price)).finally(() => {
              go({ name: 'joined-events' });
            });
          }}
        />
      )}
    </div>
  );
}

function WhosGoingCard({ event }: { event: EventItem }) {
  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background: '#14141b',
        borderWidth: '0.625px',
        borderStyle: 'solid',
        borderColor: 'rgba(255,255,255,0.08)',
      }}
    >
      <h3 className="mb-5" style={{ color: '#f5f5f7', fontSize: 18, fontWeight: 500 }}>Who's going?</h3>
      <div className="mb-5 flex items-center">
        {[
          { c: '#ec2727', l: 'A' },
          { c: '#91e357', l: 'B' },
          { c: '#a1b3e0', l: 'C' },
          { c: '#dbe12b', l: 'D' },
          { c: '#30b2ea', l: 'E' },
        ].map((a, i) => (
          <div
            key={a.l}
            className="grid size-14 place-items-center rounded-full text-white"
            style={{
              background: a.c,
              marginLeft: i === 0 ? 0 : -12,
              border: '2px solid #14141b',
              fontSize: 28,
              fontWeight: 500,
            }}
          >
            {a.l}
          </div>
        ))}
      </div>
      <p className="text-sm" style={{ color: '#8a8a99', fontWeight: 700 }}>
        {event.backers} students have locked in. {event.spotsLeft} spots remaining
      </p>
    </div>
  );
}
