export type Route =
  | { name: 'landing' }
  | { name: 'event'; id: string; fromProfile?: boolean; fromOrganiser?: boolean; fromPast?: boolean; bookingId?: string; qty?: number }
  | { name: 'checkout'; id: string; qty?: number }
  | { name: 'confirmation'; id: string; qty: number }
  | { name: 'login' }
  | { name: 'choose-account' }
  | { name: 'register-user' }
  | { name: 'register-organiser' }
  | { name: 'profile' }
  | { name: 'joined-events' }
  | { name: 'settings' }
  | { name: 'hosted-events' }
  | { name: 'create-event'; draftId?: string }
  | { name: 'edit-event'; id: string };

export type Role = 'user' | 'organiser';

// Status and pricing tier are one and the same concept now: early_bird (hype < 100%),
// greenlit (hype = 100%, event confirmed) and cancelled.
export type EventStatus = 'early_bird' | 'greenlit' | 'cancelled';
export type TierName = 'early_bird' | 'greenlit';

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
  tierLabel: string;
  currentTierName: TierName;
  hypePercentage: number;
  hypeThreshold: number;
  activeTicketCount: number;
  maxCapacity: number;
  spotsLeft: number;
  status: EventStatus;
  deadline: string;
  tiers: { tierName: TierName; label: string; price: number; qty: number; sold: number }[];
  mine?: boolean;
  endTime?: string;
  endDate?: string;
  // Raw ISO datetimes (for the countdown + edit-form validation); optional because
  // in-form drafts are constructed without them.
  startsAt?: string;
  endsAt?: string;
  deadlineAt?: string;
};

export function getActiveTier(e: EventItem): number {
  return e.status === 'greenlit' ? 1 : 0;
}

// Apply a pledge of `qty` tickets to an event, then recompute hype and capacity values.
export function applyPledge(e: EventItem, qty: number): EventItem {
  const idx = getActiveTier(e);
  const tiers = e.tiers.map((t, i) => (i === idx ? { ...t, sold: t.sold + qty } : t));
  const activeTicketCount = e.activeTicketCount + qty;
  const hypePercentage = Math.min(100, Math.round((activeTicketCount / e.hypeThreshold) * 100));
  const spotsLeft = Math.max(0, e.maxCapacity - activeTicketCount);
  return { ...e, tiers, activeTicketCount, hypePercentage, spotsLeft };
}

// Reverse a pledge of `qty` tickets, then recompute hype and capacity values.
export function reversePledge(e: EventItem, qty: number): EventItem {
  const idx = getActiveTier(e);
  const tiers = e.tiers.map((t, i) => (i === idx ? { ...t, sold: Math.max(0, t.sold - qty) } : t));
  const activeTicketCount = Math.max(0, e.activeTicketCount - qty);
  const hypePercentage = Math.min(100, Math.round((activeTicketCount / e.hypeThreshold) * 100));
  const spotsLeft = Math.max(0, e.maxCapacity - activeTicketCount);
  return { ...e, tiers, activeTicketCount, hypePercentage, spotsLeft };
}

// Status colors: Early Birds = yellow, Greenlit = green (cancelled handled separately, red).
export const TIER_COLORS = ['#ffcb3c', '#29e07a'] as const;

// The two statuses, indexed by getActiveTier (0 = early_bird, 1 = greenlit).
export const TIER_LABELS = ['Early Birds', 'Greenlit'] as const;

// Live "current tier" label — "Early Birds", and "Main Crowd" once Early Birds sell out / the event greenlights.
export function tierStageLabel(e: EventItem): string {
  return TIER_LABELS[getActiveTier(e)];
}

// Badge styling for an event: greenlit -> "Confirmed", cancelled -> "Refunded",
// otherwise the active pricing tier's stage name coloured by TIER_COLORS.
export function eventBadge(e: EventItem): { label: string; bg: string; fg: string; dot: string } {
  if (e.status === 'cancelled') return { label: 'Cancelled', bg: 'rgba(255,51,84,0.14)', fg: '#ff6b85', dot: '#ff3354' };
  if (e.status === 'greenlit') return { label: 'Greenlit', bg: 'rgba(41,224,122,0.14)', fg: '#29e07a', dot: '#29e07a' };
  return { label: 'Early Birds', bg: 'rgba(255,203,60,0.16)', fg: '#ffcb3c', dot: '#ffcb3c' };
}

// Key matching what the badge shows, used by the landing filter.
export function eventBadgeKey(e: EventItem): string {
  if (e.status === 'cancelled') return 'cancelled';
  if (e.status === 'greenlit') return 'greenlit';
  return 'early_bird';
}
