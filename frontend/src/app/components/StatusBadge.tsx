import { eventBadge, type EventItem } from './types';

export function StatusBadge({ event, label }: { event: EventItem; label?: string }) {
  const c = label
    ? { label, bg: 'rgba(255,255,255,0.06)', fg: '#8a8a99', dot: '#8a8a99' }
    : eventBadge(event);
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
