import { Calendar, Clock, MapPin, Users, Shield, ChevronLeft, ArrowRight, Timer } from 'lucide-react';
import { Countdown } from '../components/Countdown';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { TicketPricesOverTime } from '../components/TicketPricesOverTime';
import { PricingTier } from '../components/PricingTier';
import { StatusBadge } from '../components/StatusBadge';
import { MOCK_EVENTS, getActiveTier, type Role, type Route } from '../components/types';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';

export function EventDetail({ id, go, role, fromProfile, fromAdmin }: { id: string; go: (r: Route) => void; role: Role; fromProfile?: boolean; fromAdmin?: boolean }) {
  const event = MOCK_EVENTS.find((e) => e.id === id) ?? MOCK_EVENTS[0];
  const activeTier = getActiveTier(event);
  const showOptOut = !!fromProfile;
  const showWhosGoing = !!fromAdmin;

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
            <StatusBadge status={event.status} />
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { icon: Calendar, label: 'Date', value: event.date },
              { icon: Clock, label: 'Time', value: event.time },
              { icon: MapPin, label: 'Location', value: event.location.split(',')[0] },
              { icon: Users, label: 'Spots left', value: `${event.spotsLeft}` },
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
                <div className="mt-1" style={{ fontWeight: 700 }}>{event.threshold} backers</div>
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

        {showOptOut ? (
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl glass p-6 transition-all duration-300">
            <div className="mb-1 text-xs uppercase tracking-wider" style={{ color: '#29e07a' }}>You're in</div>
            <h3 className="mt-1" style={{ fontSize: 22, fontWeight: 700 }}>Pledge confirmed</h3>
            <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
              You've pledged <strong style={{ color: 'var(--foreground)' }}>${event.price}</strong> for this event. If it hits its threshold, your ticket is locked in. If not, you're refunded automatically.
            </p>

            <div className="my-5 h-px" style={{ background: 'var(--border)' }} />

            <Button
              onClick={() => go({ name: 'profile' })}
              className="w-full bg-[#ff0a0a] text-white hover:bg-[#ff2a2a]"
              style={{ borderRadius: 12, height: 52, fontSize: 16, fontWeight: 700 }}
            >
              Cancel Event
            </Button>

            <div className="mt-5 rounded-lg p-3" style={{ background: 'rgba(255,203,60,0.08)', border: '1px solid rgba(255,203,60,0.25)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: '#ffd968' }}>
                <Shield size={14} className="mt-0.5 shrink-0" />
                <span>Opting out releases your spot back to the pool. You'll be refunded in full within 3–5 business days.</span>
              </div>
            </div>
          </div>
        </aside>
        ) : showWhosGoing ? (
        <aside className="lg:sticky lg:top-24 lg:self-start" key="whos-going">
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
        </aside>
        ) : (
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl glass p-6 transition-all duration-300 shadow-xl" style={{ border: '1px solid rgba(255, 69, 0, 0.15)' }}>
            <div className="mb-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{event.tierLabel}</div>
            <div className="flex items-baseline gap-2">
              <span style={{ fontSize: 36, fontWeight: 800 }}>${event.price}</span>
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>per ticket</span>
            </div>
            <div className="mt-1 text-xs" style={{ color: '#ffd968' }}>Price rises at the next tier</div>

            <div className="my-5 h-px" style={{ background: 'var(--border)' }} />

            <Button
              onClick={() => go({ name: 'checkout', id: event.id })}
              disabled={event.status === 'cancelled'}
              className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647] disabled:opacity-50"
              style={{ borderRadius: 12, height: 52, fontSize: 16, fontWeight: 700 }}
            >
              {event.status === 'greenlit'
                ? `Buy Ticket · $${event.price}`
                : event.status === 'cancelled'
                ? 'Event cancelled'
                : `Pledge $${event.price}`}
              {event.status !== 'cancelled' && <ArrowRight size={16} className="ml-1" />}
            </Button>

            <div className="mt-5 rounded-lg p-3" style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: '#a6f3c8' }}>
                <Shield size={14} className="mt-0.5 shrink-0" />
                <span>Funds are only captured when the event hits its hype threshold. If it doesn't, you're refunded automatically.</span>
              </div>
            </div>
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}
