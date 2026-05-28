export type EventStatus = "draft" | "live" | "confirmed" | "cancelled";

export type PricingTierKind = "early" | "standard" | "final";

export type PricingTier = {
  id: string;
  name: string;
  label: string;
  price: number;
  capacity: number;
  sold: number;
  color: "green" | "yellow" | "orange" | "red";
  kind: PricingTierKind;
};

export type PartyEvent = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  date: string;
  time: string;
  location: string;
  organizer: string;
  category: string;
  status: EventStatus;
  threshold: number;
  pledged: number;
  capacity: number;
  deadline: string;
  hero: string;
  tiers: PricingTier[];
};

export type Attendee = {
  id: string;
  name: string;
  contact: string;
  eventId: string;
  tickets: number;
  tier: string;
  status: "pending" | "confirmed" | "refunded";
};

export const events: PartyEvent[] = [
  {
    id: "poolside-sesh-vol-3",
    title: "Poolside Sesh Vol. 3",
    tagline: "Golden-hour cocktails, lo-fi DJ sets and skyline views.",
    description:
      "A low-pressure poolside social built for post-finals decompression. Expect sunset sets, light bites, glow sticks and a crowd size that only locks once the hype threshold is reached.",
    date: "Sat, Jul 12",
    time: "6:30 PM",
    location: "Braddell CC",
    organizer: "SMU Social Club",
    category: "Social",
    status: "live",
    threshold: 300,
    pledged: 126,
    capacity: 800,
    deadline: "Jul 8, 11:59 PM",
    hero: "linear-gradient(135deg, #ff5a3d 0%, #171014 50%, #111827 100%)",
    tiers: [
      { id: "super", name: "Super Early", label: "Early believers", price: 12, capacity: 200, sold: 126, color: "green", kind: "early" },
      { id: "early", name: "Early", label: "Growing hype", price: 18, capacity: 200, sold: 0, color: "yellow", kind: "early" },
      { id: "standard", name: "Standard", label: "Almost there", price: 26, capacity: 300, sold: 0, color: "orange", kind: "standard" },
      { id: "final", name: "Confirmed Door", label: "Confirmed price", price: 40, capacity: 100, sold: 0, color: "red", kind: "final" },
    ],
  },
  {
    id: "hackathon-afterdark",
    title: "Hackathon Afterdark",
    tagline: "Forty-eight hours of code, one night of catharsis.",
    description:
      "A no-sleep celebration for builders, designers and friends of finalists. Open bar for finalists, guest DJ, and team awards once the event reaches enough committed backers.",
    date: "Fri, Jul 4",
    time: "10:00 PM",
    location: "The Projector",
    organizer: "SMU .hack",
    category: "CCA",
    status: "live",
    threshold: 150,
    pledged: 27,
    capacity: 300,
    deadline: "Jul 3, 11:59 PM",
    hero: "linear-gradient(135deg, #6ee787 0%, #141414 42%, #ef4444 100%)",
    tiers: [
      { id: "super", name: "Super Early", label: "Early believers", price: 15, capacity: 80, sold: 27, color: "green", kind: "early" },
      { id: "early", name: "Early", label: "Growing hype", price: 20, capacity: 80, sold: 0, color: "yellow", kind: "early" },
      { id: "standard", name: "Standard", label: "Almost there", price: 26, capacity: 100, sold: 0, color: "orange", kind: "standard" },
      { id: "final", name: "Confirmed Door", label: "Confirmed price", price: 32, capacity: 40, sold: 0, color: "red", kind: "final" },
    ],
  },
  {
    id: "concourse-sunset",
    title: "Concourse Sunset",
    tagline: "Skyline views, DJ sets and a strictly limited capacity.",
    description:
      "An intimate campus rooftop-style night for students who want a confirmed crowd without waiting until the last minute. Threshold reached, but standard tickets remain available.",
    date: "Sun, Jun 28",
    time: "5:30 PM",
    location: "Concourse Building",
    organizer: "Independent Host",
    category: "Independent",
    status: "confirmed",
    threshold: 80,
    pledged: 92,
    capacity: 120,
    deadline: "Jun 25, 6:00 PM",
    hero: "linear-gradient(135deg, #f97316 0%, #1f2937 48%, #ef4444 100%)",
    tiers: [
      { id: "super", name: "Super Early", label: "Early believers", price: 18, capacity: 30, sold: 30, color: "green", kind: "early" },
      { id: "early", name: "Early", label: "Growing hype", price: 24, capacity: 40, sold: 40, color: "yellow", kind: "early" },
      { id: "standard", name: "Standard", label: "Current tier", price: 28, capacity: 30, sold: 22, color: "orange", kind: "standard" },
      { id: "final", name: "Confirmed Door", label: "Final price", price: 35, capacity: 20, sold: 0, color: "red", kind: "final" },
    ],
  },
];

export const attendees: Attendee[] = [
  { id: "A-1021", name: "Maya Tan", contact: "maya@school.edu", eventId: "poolside-sesh-vol-3", tickets: 2, tier: "Super Early", status: "pending" },
  { id: "A-1022", name: "Darren Lim", contact: "@darrenlim", eventId: "poolside-sesh-vol-3", tickets: 1, tier: "Super Early", status: "pending" },
  { id: "A-1023", name: "Priya Shah", contact: "priya@school.edu", eventId: "concourse-sunset", tickets: 1, tier: "Standard", status: "confirmed" },
];

export function getEvent(eventId?: string) {
  return events.find((event) => event.id === eventId) ?? events[0];
}

export function getHypePercent(event: PartyEvent) {
  return Math.min(100, Math.round((event.pledged / event.threshold) * 100));
}

export function getSpotsLeft(event: PartyEvent) {
  return Math.max(0, event.capacity - event.pledged);
}

export function getActiveTier(event: PartyEvent) {
  return event.tiers.find((tier) => tier.sold < tier.capacity) ?? event.tiers[event.tiers.length - 1];
}

export function getTierProgress(tier: PricingTier) {
  if (tier.capacity === 0) return 0;
  return Math.min(100, Math.round((tier.sold / tier.capacity) * 100));
}
