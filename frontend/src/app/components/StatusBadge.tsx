import type { EventStatus } from './types';

const MAP: Record<EventStatus, { label: string; bg: string; fg: string; dot: string }> = {
  live: { label: 'Live Hype', bg: 'rgba(255,77,46,0.12)', fg: '#ff7b5e', dot: '#ff4d2e' },
  almost: { label: 'Almost There', bg: 'rgba(255,203,60,0.12)', fg: '#ffd968', dot: '#ffcb3c' },
  greenlit: { label: 'Greenlit', bg: 'rgba(41,224,122,0.14)', fg: '#5cf0a2', dot: '#29e07a' },
  cancelled: { label: 'Refunded', bg: 'rgba(255,255,255,0.06)', fg: '#8a8a99', dot: '#8a8a99' },
};

export function StatusBadge({ status }: { status: EventStatus }) {
  const c = MAP[status];
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
