import type { EventItem } from './types';

// Urgency/scarcity cue banners were intentionally removed from the product UI.
// Keep the exported helper as a harmless compatibility shim for any older imports.
export type UrgencyTone = 'hot' | 'warn';
export type UrgencyCue = { key: string; text: string; tone: UrgencyTone };

export function urgencyCues(_event: EventItem): UrgencyCue[] {
  return [];
}

export function urgencyToneStyle(tone: UrgencyTone): { color: string; bg: string; border: string } {
  return tone === 'hot'
    ? { color: '#ff8a66', bg: 'rgba(255,77,46,0.12)', border: 'rgba(255,77,46,0.35)' }
    : { color: '#ffd968', bg: 'rgba(255,203,60,0.12)', border: 'rgba(255,203,60,0.30)' };
}
