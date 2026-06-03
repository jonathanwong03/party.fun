import { createClient } from '@supabase/supabase-js';
import { format } from 'date-fns';
import { type EventItem, type EventStatus } from './components/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase environment variables are missing. Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are defined in your .env file.'
  );
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

const DEFAULT_STATUS_MAP: Record<string, EventStatus> = {
  greenlit: 'greenlit',
  failed: 'cancelled',
  completed: 'greenlit'
};

export function mapStatus(
  dbStatus: string, 
  hypePct: number, 
  statusMap = DEFAULT_STATUS_MAP
): EventStatus {
  return statusMap[dbStatus] || (hypePct >= 90 ? 'almost' : 'live');
}

export function mapDbEventToEventItem(e: any): EventItem {
  // Sort tiers by index to ensure proper timeline progression
  const sortedTiers = (e.tiers || [])
    .sort((a: any, b: any) => a.tier_index - b.tier_index)
    .map((t: any) => ({
      label: t.label,
      price: Number(t.price),
      qty: t.max_spots,
      sold: t.slots_sold || 0, // In view we have spots_sold, but let's default/sync it
    }));

  // JavaScript array.findIndex() returns -1 if no matching element is found
  const INDEX_NOT_FOUND = -1;
  const DEFAULT_FALLBACK_PRICE = 0;

  // 1. Find the first pricing tier that still has spots available (not sold out).
  // Because sortedTiers is sorted cheapest-first, findIndex() returns the index of the
  // cheapest available tier where sold tickets (t.sold) is less than total spots (t.qty).
  const activeIdx = sortedTiers.findIndex((t: any) => t.sold < t.qty);

  // 2. Retrieve the active tier (fall back to the final tier if all spots are sold out)
  let activeTier = sortedTiers[sortedTiers.length - 1];
  if (activeIdx !== INDEX_NOT_FOUND) {
    activeTier = sortedTiers[activeIdx];
  }

  // 3. Extract active price and tier labels with default fallbacks
  let currentPrice = DEFAULT_FALLBACK_PRICE;
  let currentTierLabel = 'Standard';
  if (activeTier) {
    currentPrice = activeTier.price;
    currentTierLabel = activeTier.label;
  }

  const startDate = new Date(e.start_time);
  const deadlineDate = new Date(e.deadline);

  const formattedDate = format(startDate, 'EEE, MMM d');
  const formattedTime = format(startDate, 'h:mm a');
  const formattedDeadline = format(deadlineDate, 'MMM d, h:mm a');

  const hypePct = e.backers_threshold > 0 
    ? Math.min(100, Math.floor((e.backers_count / e.backers_threshold) * 100)) 
    : 0;

  return {
    id: e.id,
    title: e.title,
    organiser: e.organiser?.full_name || 'Anonymous Organiser',
    date: formattedDate,
    time: formattedTime,
    location: e.location || 'Secret Location',
    description: e.description || '',
    image: e.image_url || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&q=80&auto=format&fit=crop',
    price: currentPrice,
    tierLabel: currentTierLabel,
    hypePct,
    threshold: e.backers_threshold,
    backers: e.backers_count || 0,
    capacity: e.hard_capacity,
    spotsLeft: e.spots_left !== undefined ? e.spots_left : e.hard_capacity,
    status: mapStatus(e.status, hypePct),
    deadline: formattedDeadline,
    tiers: sortedTiers,
  };
}
