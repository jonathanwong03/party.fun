import { createClient } from '@supabase/supabase-js';
import { format } from 'date-fns';
import { type EventItem, type EventStatus, type TierName } from './components/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are missing. The current app uses the Express mock API.');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

type EventSummaryRow = {
  id: string;
  hostId: string;
  title: string;
  description: string | null;
  location: string;
  startDate: string;
  endDate: string;
  imageUrl: string | null;
  status: EventStatus;
  currentTierName: TierName;
  deadline: string;
  hypeThreshold: number;
  maxCapacity: number;
  activeTicketCount: number;
  hypePercentage: number;
  spotsLeft: number;
  currentPrice: number;
  organiserName: string | null;
  tiers?: Array<{
    tierName: TierName;
    price: number;
    ticketCapacity: number;
    activeTicketCount: number;
  }>;
};

const TIER_LABELS: Record<TierName, string> = {
  early_bird: 'Early Birds',
  main_crowd: 'Main Crowd',
};

export function mapDbEventToEventItem(row: EventSummaryRow): EventItem {
  const tiers = (row.tiers ?? [])
    .sort((a, b) => (a.tierName === 'early_bird' ? -1 : b.tierName === 'early_bird' ? 1 : 0))
    .map((tier) => ({
      tierName: tier.tierName,
      label: TIER_LABELS[tier.tierName],
      price: Number(tier.price),
      qty: tier.ticketCapacity,
      sold: tier.activeTicketCount,
    }));

  return {
    id: row.id,
    hostId: row.hostId,
    title: row.title,
    organiser: row.organiserName ?? 'Unknown organiser',
    date: format(new Date(row.startDate), 'EEE, MMM d'),
    time: format(new Date(row.startDate), 'h:mm a'),
    endDate: format(new Date(row.endDate), 'EEE, MMM d'),
    endTime: format(new Date(row.endDate), 'h:mm a'),
    location: row.location,
    description: row.description ?? '',
    image: row.imageUrl ?? '',
    price: Number(row.currentPrice),
    tierLabel: TIER_LABELS[row.currentTierName],
    currentTierName: row.currentTierName,
    hypePercentage: row.hypePercentage,
    hypeThreshold: row.hypeThreshold,
    activeTicketCount: row.activeTicketCount,
    maxCapacity: row.maxCapacity,
    spotsLeft: row.spotsLeft,
    status: row.status,
    deadline: format(new Date(row.deadline), 'MMM d, h:mm a'),
    tiers,
  };
}
