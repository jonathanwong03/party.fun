export type Route =
  | { name: 'landing' }
  | { name: 'event'; id: string; fromProfile?: boolean; fromOrganiser?: boolean; fromPast?: boolean; bookingId?: string; qty?: number }
  | { name: 'checkout'; id: string; qty?: number }
  | { name: 'confirmation'; id: string; qty: number; lines?: { label: string; count: number; subtotalText: string }[]; reference?: string }
  | { name: 'attendees'; id: string }
  | { name: 'login' }
  | { name: 'forgot-password' }
  | { name: 'verify-code'; email: string }
  | { name: 'reset-confirm'; email: string; code: string }
  | { name: 'reset-password'; email: string; code: string }
  | { name: 'choose-account' }
  | { name: 'register-user' }
  | { name: 'register-organiser' }
  | { name: 'profile' }
  | { name: 'joined-events' }
  | { name: 'settings' }
  | { name: 'wallet' }
  | { name: 'hosted-events'; tab?: 'created' | 'drafts' }
  | { name: 'create-event'; draftId?: string }
  | { name: 'edit-event'; id: string };

export type Role = 'user' | 'organiser';

// Status and pricing status are one and the same concept now:
//   early_bird = hype < 100%, greenlit = hype = 100% (event confirmed),
//   completed = the event date has passed, cancelled = cancelled.
export type EventStatus = 'early_bird' | 'greenlit' | 'cancelled' | 'completed';
// The two price statuses an event sells through (the pricing dimension).
export type StatusName = 'early_bird' | 'greenlit';

export type EventItem = {
  id: string;
  hostId?: string;
  title: string;
  organiser: string;
  date: string;
  time: string;
  location: string;
  description: string;
  image: string;
  price: number;
  statusLabel: string;
  hypePercentage: number;
  hypeThreshold: number;
  activeTicketCount: number;
  maxCapacity: number;
  spotsLeft: number;
  status: EventStatus;
  deadline: string;
  statuses: { statusName: StatusName; label: string; price: number; qty: number; sold: number; fillPct?: number }[];
  mine?: boolean;
  // Backend flags the single most-hyped open event so the Landing page renders only.
  featured?: boolean;
  endTime?: string;
  endDate?: string;
  // Raw ISO datetimes (for the countdown + edit-form validation); optional because
  // in-form drafts are constructed without them.
  startsAt?: string;
  endsAt?: string;
  deadlineAt?: string;
  // Backend-computed: uncapped fill ratio + long date / compact time strings.
  hypeRatio?: number;
  startLong?: string;
  startClock?: string;
  endLong?: string;
  endClock?: string;
};

// Index into the price-status arrays/colors: 1 once greenlit, else 0 (early_bird).
export function getActiveStatus(e: EventItem): number {
  return e.status === 'greenlit' ? 1 : 0;
}

// Price-status colors: Early Birds = yellow, Greenlit = green.
export const STATUS_COLORS = ['#ffcb3c', '#29e07a'] as const;

// The two price statuses, indexed by getActiveStatus (0 = early_bird, 1 = greenlit).
export const STATUS_LABELS = ['Early Birds', 'Greenlit'] as const;

// Live "current status" label — "Early Birds" while gathering hype, "Greenlit" once confirmed.
export function statusStageLabel(e: EventItem): string {
  return STATUS_LABELS[getActiveStatus(e)];
}

// Badge styling for an event: cancelled -> red, completed -> grey, greenlit -> green,
// otherwise early_bird -> yellow.
export function eventBadge(e: EventItem): { label: string; bg: string; fg: string; dot: string } {
  if (e.status === 'cancelled') return { label: 'Cancelled', bg: 'rgba(255,51,84,0.14)', fg: '#ff6b85', dot: '#ff3354' };
  if (e.status === 'completed') return { label: 'Completed', bg: 'rgba(255,255,255,0.06)', fg: '#9a9aa5', dot: '#8a8a99' };
  if (e.status === 'greenlit') return { label: 'Greenlit', bg: 'rgba(41,224,122,0.14)', fg: '#29e07a', dot: '#29e07a' };
  return { label: 'Early Birds', bg: 'rgba(255,203,60,0.16)', fg: '#ffcb3c', dot: '#ffcb3c' };
}

// Key matching what the badge shows, used by the landing filter.
export function eventBadgeKey(e: EventItem): string {
  if (e.status === 'cancelled') return 'cancelled';
  if (e.status === 'completed') return 'completed';
  if (e.status === 'greenlit') return 'greenlit';
  return 'early_bird';
}
