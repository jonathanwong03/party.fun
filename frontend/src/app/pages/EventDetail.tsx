import { useEffect, useState } from 'react';
import { CalendarClock, MapPin, Shield, ChevronLeft, ArrowRight, Timer, Minus, Plus, Mail } from 'lucide-react';
import { Countdown } from '../components/Countdown';
import { Button } from '../components/ui/button';
import { HypeMeter } from '../components/HypeMeter';
import { DeleteEventModal } from '../components/DeleteEventModal';
import { HowToGetThere } from '../components/HowToGetThere';
import { getActiveStatus, statusStageLabel, type EventItem, type Role, type Route } from '../components/types';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { DEFAULT_EVENT_IMAGE } from '../components/media';
import { fetchAttendees, type Attendee } from '../api';
import { formatEventLocation } from '../components/eventDisplay';
import { universityLabel } from '../components/universities';

const AVATAR_COLORS = ['#ec2727', '#91e357', '#a1b3e0', '#dbe12b', '#30b2ea', '#ff8a3d', '#b07cff'];
function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function EventDetail({ id, go, role, events, purchasedEventIds, bookingId, qty, onGiveAway, fromProfile, fromOrganiser, fromPast }: { id: string; go: (r: Route) => void; role: Role | null; events: EventItem[]; purchasedEventIds?: Set<string>; bookingId?: string; qty?: number; onGiveAway?: (bookingId: string, quantity: number) => Promise<void>; fromProfile?: boolean; fromOrganiser?: boolean; fromPast?: boolean }) {
  const event = events.find((e) => e.id === id);
  const [cancelling, setCancelling] = useState(false);
  const [giveAwayQty, setGiveAwayQty] = useState(1);
  const [buyQty, setBuyQty] = useState(1);
  if (!event) {
    return (
      <div className="mx-auto max-w-[1536px] px-6 py-20 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Loading event...
      </div>
    );
  }
  const activeStatus = getActiveStatus(event);
  // Tickets still available (computed by the backend; equals capacity minus active tickets).
  const available = event.spotsLeft;
  const alreadyPurchased = !!purchasedEventIds?.has(event.id);
  const unavailable = event.status === 'cancelled';
  const showCancelledCard = !!fromPast;
  const showOptOut = !!fromProfile;
  // Admins don't purchase — show them the read-only "who's going" panel, never the buy card.
  const showWhosGoing = !!fromOrganiser || role === 'admin';
  // You can't pledge to an event you created yourself — show a notice instead of the Pledge/Buy card.
  const showOwnEvent = !!role && !!event.mine && !showCancelledCard && !showOptOut && !showWhosGoing;
  const fullLocation = formatEventLocation(event);
  const hostUniversity = universityLabel(event.hostUniversity);
  // University-restricted events: block the buy card when the signed-in viewer isn't a member.
  // Show the short code (e.g. "SMU members only") so the notice fits.
  const restrictedUniCode = event.restrictedUniversity ?? '';
  const universityBlocked = !!event.restrictedUniversity && event.canAttendUniversity === false;

  return (
    <div className="mx-auto max-w-[1536px] px-6 py-8">
      <button
        onClick={() => go(fromOrganiser ? { name: 'hosted-events' } : { name: 'landing' })}
        className="mb-4 inline-flex items-center gap-1 text-sm transition hover:text-foreground"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <ChevronLeft size={14} /> {fromOrganiser ? 'Back to hosted events' : 'Back to events'}
      </button>

      {/* banner */}
      <div className="relative mb-8 overflow-hidden rounded-3xl">
        <ImageWithFallback src={event.image || DEFAULT_EVENT_IMAGE} alt={event.title} className="h-72 w-full object-cover md:h-96" />
        {!event.image && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.28)' }} />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0f] via-[#0b0b0f]/30 to-transparent" />
        <div className="absolute inset-x-6 bottom-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-white" style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {event.title}
            </h1>
            <p className="mt-2 text-white/85" style={{ fontSize: 17, fontWeight: 700 }}>Hosted by {event.organiser}</p>
            {hostUniversity && <p className="mt-1 text-white/80" style={{ fontSize: 16, fontWeight: 600 }}>{hostUniversity}</p>}
            {restrictedUniCode && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs" style={{ background: 'rgba(255,51,84,0.14)', color: '#ff6b85', fontWeight: 700 }}>
                <Shield size={12} /> {restrictedUniCode} members only
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          {/* meta */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl glass p-4 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                <CalendarClock size={13} /> Starts
              </div>
              <div className="mt-1 font-bold text-white">{event.startLong || event.date}</div>
              <div className="font-bold text-white">{event.startClock || event.time}</div>
            </div>
            <div className="rounded-xl glass p-4 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                <CalendarClock size={13} /> Ends
              </div>
              <div className="mt-1 font-bold text-white">{event.endLong || event.endDate}</div>
              <div className="font-bold text-white">{event.endClock || event.endTime}</div>
            </div>
            <div className="rounded-xl glass p-4 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                <MapPin size={13} /> Location
              </div>
              {event.location && <div className="mt-1 font-bold text-white">{event.location}</div>}
              {event.address && <div className={`${event.location ? '' : 'mt-1 '}font-bold text-white`}>{event.address}</div>}
              {!event.location && !event.address && <div className="mt-1 font-bold text-white">{fullLocation}</div>}
              {fullLocation && (
                <HowToGetThere destination={fullLocation} />
              )}
            </div>
          </div>

          {/* description */}
          <div className="rounded-2xl glass p-6 transition-all duration-300">
            <h2 className="mb-3">About this party</h2>
            <p style={{ color: 'var(--muted-foreground)' }}>{event.description}</p>
          </div>

          {/* Hype meter */}
          <div className="rounded-2xl glass p-6 transition-all duration-300">
            <div className="mb-4 flex items-baseline justify-between">
              <h3>Hype meter</h3>
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Deadline: {event.deadline}</span>
            </div>
            <HypeMeter pct={event.hypePercentage} status={event.status} statusIndex={activeStatus} size="lg" activeTicketCount={event.activeTicketCount} hypeThreshold={event.hypeThreshold} />

            {/* Countdown */}
            {event.status !== 'greenlit' && event.status !== 'cancelled' && (
              <div className="mt-5 rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
                <div className="mb-3 flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  <Timer size={12} /> Event starts in
                  <span className="ml-auto font-medium" style={{ color: 'var(--foreground)' }}>{event.date}</span>
                </div>
                <Countdown targetIso={event.startsAt} deadline={event.deadline} />
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Threshold</div>
                <div className="mt-1" style={{ fontWeight: 700 }}>{event.hypeThreshold} </div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Pledged</div>
                <div className="mt-1" style={{ fontWeight: 700 }}>{event.activeTicketCount}</div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Spots left</div>
                <div className="mt-1" style={{ fontWeight: 700 }}>{event.spotsLeft}</div>
              </div>
            </div>
          </div>

          {/* how it works */}
          <div className="rounded-2xl glass p-6 transition-all duration-300">
            <h3 className="mb-3">How it works</h3>
            <ol className="space-y-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>
              <li><strong>Buy early</strong> — the early_bird status is cheaper.</li>
              <li><strong>Reach the hype threshold</strong> — the event is confirmed.</li>
              <li><strong>Miss the hype threshold?</strong> Active tickets are automatically refunded in full.</li>
            </ol>
          </div>
        </div>

        {showCancelledCard ? (
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="mb-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{statusStageLabel(event)}</div>
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
                <span>Payments were captured at checkout. Active tickets are refunded automatically if the event misses its hype threshold.</span>
              </div>
            </div>
          </div>
        </aside>
        ) : showOptOut ? (
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl glass p-6 transition-all duration-300">
            <div className="mb-1 text-xs uppercase tracking-wider" style={{ color: '#29e07a' }}>You're in</div>
            <h3 className="mt-1" style={{ fontSize: 22, fontWeight: 700 }}>Tickets pledged</h3>
            <div className="mt-1 text-sm" style={{ color: 'var(--foreground)', fontWeight: 600 }}>
              {(qty ?? 1)}× ticket{(qty ?? 1) === 1 ? '' : 's'}
            </div>
            <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
              Your payment was captured when you pledged. If the event misses its hype threshold, active tickets are refunded automatically.
            </p>

            <div className="mt-4 rounded-lg p-3" style={{ background: 'rgba(255,77,46,0.08)', border: '1px solid rgba(255,77,46,0.25)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: '#ffb4a3' }}>
                <Mail size={14} className="mt-0.5 shrink-0" />
                <span>🎟️ Your tickets were emailed to you — check your inbox (and spam) for the printable PDF with each ticket's QR code.</span>
              </div>
            </div>

            <div className="my-5 h-px" style={{ background: 'var(--border)' }} />

            <Button
              onClick={() => setCancelling(true)}
              className="w-full bg-[#ff0a0a] text-white hover:bg-[#ff2a2a]"
              style={{ borderRadius: 12, height: 52, fontSize: 16, fontWeight: 700 }}
            >
              Give Away Tickets
            </Button>

            <div className="mt-5 rounded-lg p-3" style={{ background: 'rgba(255,122,147,0.08)', border: '1px solid rgba(255,122,147,0.3)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: '#ff7a93' }}>
                <Shield size={14} className="mt-0.5 shrink-0" />
                <span>Giving away tickets is final. You will <strong>not</strong> be refunded, and released spots return to the public pool.</span>
              </div>
            </div>
          </div>
          <WhosGoingCard event={event} go={go} role={role} />
        </aside>
        ) : showWhosGoing ? (
        <aside className="lg:sticky lg:top-24 lg:self-start" key="whos-going">
          <WhosGoingCard event={event} go={go} role={role} />
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
            <div className="mb-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{statusStageLabel(event)}</div>
            <div className="flex items-baseline gap-2">
              <span style={{ fontSize: 36, fontWeight: 800 }}>${event.price}</span>
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>per ticket</span>
            </div>
            {event.status !== 'greenlit' && <div className="mt-1 text-xs" style={{ color: '#ffd968' }}>Price rises at the next status</div>}

            {!alreadyPurchased && !unavailable && !universityBlocked && (
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

            {alreadyPurchased ? (
              <p className="py-3 text-center text-sm" style={{ color: 'var(--muted-foreground)', fontWeight: 600 }}>
                Tickets already purchased
              </p>
            ) : unavailable ? (
              <Button
                disabled
                className="w-full disabled:opacity-100"
                style={{ background: 'rgba(255,51,84,0.08)', color: '#ff3354', border: '1px solid rgba(255,51,84,0.4)', borderRadius: 12, height: 52, fontSize: 16, fontWeight: 700 }}
              >
                Event unavailable
              </Button>
            ) : universityBlocked ? (
              <Button
                disabled
                className="w-full disabled:opacity-100"
                style={{ background: 'rgba(255,51,84,0.08)', color: '#ff3354', border: '1px solid rgba(255,51,84,0.4)', borderRadius: 12, height: 52, fontSize: 15, fontWeight: 700 }}
              >
                {restrictedUniCode} members only
              </Button>
            ) : (
              <Button
                onClick={() => go(role ? { name: 'checkout', id: event.id, qty: buyQty } : { name: 'login' })}
                disabled={available === 0}
                className="w-full bg-[#ff4d2e] text-white hover:bg-[#ff6647] disabled:opacity-50"
                style={{ borderRadius: 12, height: 52, fontSize: 16, fontWeight: 700 }}
              >
                {event.status === 'greenlit' ? 'Buy' : 'Pledge'}
                <ArrowRight size={16} className="ml-1" />
              </Button>
            )}

            <div className="mt-5 rounded-lg p-3" style={{ background: 'rgba(41,224,122,0.08)', border: '1px solid rgba(41,224,122,0.25)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: '#a6f3c8' }}>
                <Shield size={14} className="mt-0.5 shrink-0" />
                <span>Your payment is captured now. Active tickets are refunded automatically if the event misses its hype threshold.</span>
              </div>
            </div>
          </div>
          <WhosGoingCard event={event} go={go} role={role} />
        </aside>
        )}
      </div>

      {cancelling && (
        <DeleteEventModal
          eventName={event.title}
          confirmWord="CONFIRM"
          title="Give Away Tickets?"
          leadIn="You're about to give away tickets for"
          warning="Giving away tickets is final. You will NOT be refunded. Released spots return to the public ticket pool."
          actionLabel="Give Away Tickets"
          quantity={giveAwayQty}
          maxQuantity={qty ?? 1}
          onQuantityChange={setGiveAwayQty}
          quantityPrompt="How many of these tickets would you like to give away?"
          onCancel={() => setCancelling(false)}
          onConfirm={() => {
            setCancelling(false);
            Promise.resolve(bookingId ? onGiveAway?.(bookingId, giveAwayQty) : undefined).finally(() => {
              go({ name: 'joined-events' });
            });
          }}
        />
      )}
    </div>
  );
}

function WhosGoingCard({ event, go, role }: { event: EventItem; go: (r: Route) => void; role: Role | null }) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);

  useEffect(() => {
    let ignore = false;
    fetchAttendees(event.id)
      .then((a) => { if (!ignore) setAttendees(a); })
      .catch(() => { if (!ignore) setAttendees([]); });
    return () => { ignore = true; };
  }, [event.id, event.activeTicketCount]);

  const shown = attendees.slice(0, 5);
  const overflow = Math.max(0, attendees.length - shown.length);

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
        {shown.length === 0 ? (
          <span className="text-sm" style={{ color: '#8a8a99' }}>No tickets locked in yet.</span>
        ) : (
          shown.map((a, i) => (
            <div key={a.username} className="group relative" style={{ marginLeft: i === 0 ? 0 : -12 }}>
              {a.avatarUrl ? (
                <img
                  src={a.avatarUrl}
                  alt={a.username}
                  referrerPolicy="no-referrer"
                  className="size-14 rounded-full object-cover"
                  style={{ border: '2px solid #14141b' }}
                />
              ) : (
                <div
                  className="grid size-14 place-items-center rounded-full text-white"
                  style={{ background: avatarColor(a.username), border: '2px solid #14141b', fontSize: 28, fontWeight: 500 }}
                >
                  {(a.name || a.username).charAt(0).toUpperCase()}
                </div>
              )}
              {/* Hover tooltip with the username — shown only when signed in. */}
              {role && (
                <div
                  className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs shadow-lg group-hover:block"
                  style={{ background: '#ffffff', color: '#1a1a1a', fontWeight: 600 }}
                >
                  {a.username}
                </div>
              )}
            </div>
          ))
        )}
        {overflow > 0 && (
          <div
            className="grid size-14 place-items-center rounded-full"
            style={{ marginLeft: -12, background: '#23232c', border: '2px solid #14141b', color: '#c9c9d4', fontSize: 16, fontWeight: 600 }}
          >
            +{overflow}
          </div>
        )}
      </div>

      <p className="mb-4 text-sm" style={{ color: '#8a8a99', fontWeight: 700 }}>
        {event.activeTicketCount} tickets locked in. {event.spotsLeft} spots remaining
      </p>

      <Button
        onClick={() => go(role ? { name: 'attendees', id: event.id } : { name: 'login' })}
        variant="outline"
        className="w-full border-white/15 bg-transparent hover:bg-white/5"
        style={{ borderRadius: 12, height: 42, fontWeight: 600 }}
      >
        View Details
      </Button>
    </div>
  );
}
