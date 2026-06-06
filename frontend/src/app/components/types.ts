export type Route =
  | { name: 'landing' }
  | { name: 'event'; id: string; fromProfile?: boolean; fromOrganiser?: boolean; fromPast?: boolean; qty?: number; amount?: number; total?: number }
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

export type EventStatus = 'live' | 'almost' | 'greenlit' | 'cancelled';

export type EventItem = {
  id: string;
  title: string;
  organiser: string;
  date: string;
  time: string;
  location: string;
  description: string;
  image: string;
  price: number;
  tierLabel: string;
  hypePct: number;
  threshold: number;
  backers: number;
  capacity: number;
  spotsLeft: number;
  status: EventStatus;
  deadline: string;
  tiers: { label: string; price: number; qty: number; sold: number }[];
  mine?: boolean;
  endTime?: string;
  endDate?: string;
};

export function getActiveTier(e: EventItem): number {
  const last = Math.max(0, e.tiers.length - 1);
  const idx = e.tiers.findIndex((t) => t.sold < t.qty);
  if (idx === -1) return last;
  return Math.min(idx, last);
}

// Apply a pledge of `qty` tickets to an event: bump the active tier's sold count and the
// backer count, then recompute hype % and spots left. Returns a new EventItem (never mutates).
export function applyPledge(e: EventItem, qty: number): EventItem {
  const idx = getActiveTier(e);
  const tiers = e.tiers.map((t, i) => (i === idx ? { ...t, sold: t.sold + qty } : t));
  const backers = e.backers + qty;
  const hypePct = Math.min(100, Math.round((backers / e.threshold) * 100));
  const spotsLeft = Math.max(0, e.capacity - backers);
  return { ...e, tiers, backers, hypePct, spotsLeft };
}

// Reverse a pledge of `qty` tickets (the inverse of applyPledge): drop the active tier's sold
// count and the backer count by `qty` (floored at 0), then recompute hype % and spots left.
export function reversePledge(e: EventItem, qty: number): EventItem {
  const idx = getActiveTier(e);
  const tiers = e.tiers.map((t, i) => (i === idx ? { ...t, sold: Math.max(0, t.sold - qty) } : t));
  const backers = Math.max(0, e.backers - qty);
  const hypePct = Math.min(100, Math.round((backers / e.threshold) * 100));
  const spotsLeft = Math.max(0, e.capacity - backers);
  return { ...e, tiers, backers, hypePct, spotsLeft };
}

export const TIER_COLORS = ['#29e07a', '#ff8a2e'] as const;

// The two pricing tiers: Early Birds fills the hype threshold; Main Crowd is the post-greenlit phase.
export const TIER_LABELS = ['Early Birds', 'Main Crowd'] as const;

// Live "current tier" label — "Early Birds", and "Main Crowd" once Early Birds sell out / the event greenlights.
export function tierStageLabel(e: EventItem): string {
  return TIER_LABELS[getActiveTier(e)];
}

// Badge styling for an event: greenlit -> "Confirmed", cancelled -> "Refunded",
// otherwise the active pricing tier's stage name coloured by TIER_COLORS.
export function eventBadge(e: EventItem): { label: string; bg: string; fg: string; dot: string } {
  if (e.status === 'cancelled') return { label: 'Cancelled by Organiser', bg: 'rgba(255,255,255,0.06)', fg: '#8a8a99', dot: '#8a8a99' };
  if (e.status === 'greenlit') return { label: 'Confirmed', bg: 'rgba(255,51,84,0.14)', fg: '#ff6b85', dot: '#ff3354' };
  const t = getActiveTier(e);
  const c = TIER_COLORS[t];
  return { label: TIER_LABELS[t], bg: `${c}1f`, fg: c, dot: c };
}

// Key matching what the badge shows, used by the landing filter.
export function eventBadgeKey(e: EventItem): string {
  if (e.status === 'cancelled') return 'cancelled';
  if (e.status === 'greenlit') return 'greenlit';
  return `tier${getActiveTier(e)}`;
}

export const PLEDGED_EVENT_IDS = new Set(['e1', 'e2', 'e3', 'e6']);

export const MOCK_EVENTS: EventItem[] = [
  {
    id: 'e1',
    mine: true,
    title: 'Neon Jungle: Freshers Rave',
    organiser: 'NUS Electronic Music Club',
    date: 'Fri, Jun 12',
    time: '10:00 PM',
    endTime: '2:00 AM',
    endDate: 'Sat, Jun 13',
    location: 'The Projector, Golden Mile Tower',
    description:
      'A night of bass-heavy beats, UV body paint and free-flow mocktails. Capping our orientation week with the loudest party on campus.',
    image:
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80&auto=format&fit=crop',
    price: 12,
    tierLabel: 'Early Birds',
    hypePct: 78,
    threshold: 200,
    backers: 156,
    capacity: 400,
    spotsLeft: 244,
    status: 'almost',
    deadline: 'Jun 10, 11:59 PM',
    tiers: [
      { label: 'Early Birds', price: 12, qty: 200, sold: 156 },
      { label: 'Main Crowd', price: 22, qty: 200, sold: 0 },
    ],
  },
  {
    id: 'e2',
    title: 'CCA Mashup: Inter-Club Block Party',
    organiser: 'NTU Cultural Council',
    date: 'Sat, Jun 20',
    time: '7:00 PM',
    endTime: '11:00 PM',
    endDate: 'Sat, Jun 20',
    location: 'NTU North Spine Plaza',
    description:
      'Eight clubs, one yard. Live bands, dance crews, food trucks and a glow-stick finale.',
    image:
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&q=80&auto=format&fit=crop',
    price: 10,
    tierLabel: 'Early Birds',
    hypePct: 42,
    threshold: 300,
    backers: 126,
    capacity: 800,
    spotsLeft: 674,
    status: 'live',
    deadline: 'Jun 18, 8:00 PM',
    tiers: [
      { label: 'Early Birds', price: 10, qty: 300, sold: 126 },
      { label: 'Main Crowd', price: 18, qty: 500, sold: 0 },
    ],
  },
  {
    id: 'e3',
    mine: true,
    title: 'Rooftop Sundown Sessions',
    organiser: 'SMU Photography Society',
    date: 'Sun, Jun 28',
    time: '5:30 PM',
    endTime: '8:30 PM',
    endDate: 'Sun, Jun 28',
    location: 'Concourse Building, Level 12',
    description:
      'Golden-hour cocktails, lo-fi DJ sets and skyline views. Strictly limited capacity.',
    image:
      'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=1200&q=80&auto=format&fit=crop',
    price: 32,
    tierLabel: 'Main Crowd',
    hypePct: 100,
    threshold: 80,
    backers: 92,
    capacity: 120,
    spotsLeft: 28,
    status: 'greenlit',
    deadline: 'Jun 25, 6:00 PM',
    tiers: [
      { label: 'Early Birds', price: 18, qty: 80, sold: 80 },
      { label: 'Main Crowd', price: 32, qty: 40, sold: 12 },
    ],
  },
  {
    id: 'e4',
    title: 'Hackathon Afterglow',
    organiser: 'SUTD Dev Society',
    date: 'Sat, Jul 5',
    time: '9:00 PM',
    endTime: '1:00 AM',
    endDate: 'Sun, Jul 6',
    location: 'Tanjong Pagar Distripark',
    description:
      'Forty-eight hours of code, one night of catharsis. Open bar for finalists.',
    image:
      'https://images.unsplash.com/photo-1571266028243-d220c6a23f37?w=1200&q=80&auto=format&fit=crop',
    price: 15,
    tierLabel: 'Early Birds',
    hypePct: 18,
    threshold: 150,
    backers: 27,
    capacity: 300,
    spotsLeft: 273,
    status: 'live',
    deadline: 'Jul 3, 11:59 PM',
    tiers: [
      { label: 'Early Birds', price: 15, qty: 150, sold: 27 },
      { label: 'Main Crowd', price: 27, qty: 150, sold: 0 },
    ],
  },
  {
    id: 'e5',
    title: 'Silent Disco @ Sentosa',
    organiser: 'NUS Adventure Club',
    date: 'Fri, Jul 11',
    time: '8:00 PM',
    endTime: '11:00 PM',
    endDate: 'Fri, Jul 11',
    location: 'Tanjong Beach, Sentosa',
    description:
      'Three channels, one beach, zero noise complaints. Headphones provided.',
    image:
      'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=1200&q=80&auto=format&fit=crop',
    price: 16,
    tierLabel: 'Early Birds',
    hypePct: 64,
    threshold: 180,
    backers: 115,
    capacity: 250,
    spotsLeft: 135,
    status: 'almost',
    deadline: 'Jul 9, 9:00 PM',
    tiers: [
      { label: 'Early Birds', price: 16, qty: 180, sold: 115 },
      { label: 'Main Crowd', price: 29, qty: 70, sold: 0 },
    ],
  },
  {
    id: 'e6',
    mine: true,
    title: 'Open Mic & Lo-Fi Lounge',
    organiser: 'SMU Writers Guild',
    date: 'Thu, Jul 17',
    time: '7:30 PM',
    endTime: '10:30 PM',
    endDate: 'Thu, Jul 17',
    location: 'The Hangar, SMU Connexion',
    description:
      'Spoken word, acoustic sets and shared playlists. BYO notebooks.',
    image:
      'https://images.unsplash.com/photo-1485579149621-3123dd979885?w=1200&q=80&auto=format&fit=crop',
    price: 8,
    tierLabel: 'Early Birds',
    hypePct: 9,
    threshold: 120,
    backers: 11,
    capacity: 200,
    spotsLeft: 189,
    status: 'cancelled',
    deadline: 'Jul 15, 8:00 PM',
    tiers: [
      { label: 'Early Birds', price: 8, qty: 120, sold: 11 },
      { label: 'Main Crowd', price: 14, qty: 80, sold: 0 },
    ],
  },
];
