import type { EventItem } from './types';

// Urgency / scarcity cues derived ONLY from real backend fields — no invented
// scarcity. Returned in priority order; callers can take the first N. Empty for
// cancelled/completed events (nothing to act on).
export type UrgencyTone = 'hot' | 'warn';
export type UrgencyCue = { key: string; text: string; tone: UrgencyTone };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole days from now until an ISO timestamp; null if unparseable.
function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTarget = new Date(t);
  startOfTarget.setHours(0, 0, 0, 0);
  return Math.round((startOfTarget.getTime() - startOfToday.getTime()) / MS_PER_DAY);
}

export function urgencyCues(event: EventItem): UrgencyCue[] {
  if (event.status === 'cancelled' || event.status === 'completed') return [];
  const cues: UrgencyCue[] = [];

  // Low remaining capacity.
  if (typeof event.spotsLeft === 'number' && event.spotsLeft > 0 && event.spotsLeft <= 10) {
    cues.push({ key: 'spots', text: `Only ${event.spotsLeft} spot${event.spotsLeft === 1 ? '' : 's'} left`, tone: 'hot' });
  }

  // Pledge deadline approaching (only while still gathering hype).
  if (event.status !== 'greenlit') {
    const d = daysUntil(event.deadlineAt);
    if (d !== null && d >= 0) {
      if (d === 0) cues.push({ key: 'deadline', text: 'Ends today', tone: 'hot' });
      else if (d <= 2) cues.push({ key: 'deadline', text: 'Pledge deadline soon', tone: 'hot' });
      else if (d <= 7) cues.push({ key: 'deadline', text: `${d} days left`, tone: 'warn' });
    }
  }

  // Hype momentum toward greenlit.
  if (event.status === 'early_bird' && typeof event.hypePercentage === 'number') {
    if (event.hypePercentage >= 80) cues.push({ key: 'hype', text: 'Almost greenlit', tone: 'hot' });
    else if (event.hypePercentage >= 50) cues.push({ key: 'hype', text: `${event.hypePercentage}% to greenlit`, tone: 'warn' });
  }

  // Rising bonding-curve price.
  if (event.hypeDrivenPricing) {
    cues.push({ key: 'pricing', text: 'Price may rise as more tickets are bought', tone: 'warn' });
  }

  return cues;
}

// Tone → colours matching the app palette (orange = hot, amber = warn).
export function urgencyToneStyle(tone: UrgencyTone): { color: string; bg: string; border: string } {
  return tone === 'hot'
    ? { color: '#ff8a66', bg: 'rgba(255,77,46,0.12)', border: 'rgba(255,77,46,0.35)' }
    : { color: '#ffd968', bg: 'rgba(255,203,60,0.12)', border: 'rgba(255,203,60,0.30)' };
}
