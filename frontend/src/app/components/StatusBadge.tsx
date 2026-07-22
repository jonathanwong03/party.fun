import { eventBadge, type EventItem } from './types';

// Bright status colours for the badge when it sits on a dark image (event cards). Elsewhere the
// badge uses the theme's deeper --status-* tokens so it reads on light card surfaces.
const BRIGHT_FG: Record<string, string> = {
  Greenlit: '#29e07a',
  'Early Birds': '#ffcb3c',
  Cancelled: '#ff3354',
};

export function StatusBadge({ event, label, bright }: { event: EventItem; label?: string; bright?: boolean }) {
  const c = label
    ? { label, bg: 'rgba(255,255,255,0.06)', fg: '#8a8a99', dot: '#8a8a99' }
    : eventBadge(event);
  // On event-card images, force the original vibrant green/yellow/red for the text + dot.
  const brightColor = bright ? BRIGHT_FG[c.label] : undefined;
  const fg = brightColor ?? c.fg;
  const dot = brightColor ?? c.dot;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
      style={{ background: c.bg, color: fg, fontWeight: 600 }}
    >
      <span className="size-1.5 rounded-full" style={{ background: dot }} />
      {c.label}
    </span>
  );
}
