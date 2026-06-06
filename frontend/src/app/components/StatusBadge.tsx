import { eventBadge, type EventItem } from './types';

export function StatusBadge({ event, label, detail }: { event: EventItem; label?: string; detail?: boolean }) {
  let c = label
    ? { label, bg: 'rgba(255,255,255,0.06)', fg: '#8a8a99', dot: '#8a8a99' }
    : eventBadge(event);
  // The event-detail banner relabels the badge while keeping the same colors: greenlit reads
  // "Greenlit", the gathering-hype phase reads "Gathering Hype" (cancelled is left untouched).
  if (detail && !label) {
    const detailLabel = event.status === 'greenlit' ? 'Greenlit' : event.status === 'cancelled' ? c.label : 'Gathering Hype';
    c = { ...c, label: detailLabel };
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
      style={{ background: c.bg, color: c.fg, fontWeight: 600 }}
    >
      <span className="size-1.5 rounded-full" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}
