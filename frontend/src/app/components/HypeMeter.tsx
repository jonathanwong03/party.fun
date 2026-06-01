import { TIER_COLORS } from './types';
import type { EventStatus } from './types';

export function HypeMeter({
  pct,
  status,
  tier,
  size = 'md',
  showLabel = true,
  backers,
  threshold,
}: {
  pct: number;
  status: EventStatus;
  tier: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  backers?: number;
  threshold?: number;
}) {
  const capped = Math.min(100, Math.max(0, pct));
  const t = Math.max(0, Math.min(3, tier));
  const color = status === 'cancelled' ? '#5a5a66' : '#ffffff';
  const tierColor = status === 'cancelled' ? '#5a5a66' : TIER_COLORS[t];
  const gradient = status === 'cancelled' ? '#5a5a66' : '#ffffff';
  const glow = status === 'cancelled' ? 'none' : '0 0 10px rgba(255,255,255,0.35)';

  const trackH = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';
  const tierLabel = ['Tier 1 · Early believers', 'Tier 2 · Growing hype', 'Tier 3 · Almost there', 'Greenlit'][t];

  return (
    <div className="w-full">
      {showLabel && size === 'lg' ? (
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div style={{ fontSize: 36, fontWeight: 800, color, lineHeight: 1 }}>{capped}%</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {backers !== undefined && threshold !== undefined
                ? `${backers} of ${threshold} tickets`
                : tierLabel}
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs" style={{ background: `${tierColor}18`, color: tierColor }}>
            <span className="size-1.5 rounded-full" style={{ background: tierColor, boxShadow: `0 0 6px ${tierColor}` }} />
            {tierLabel}
          </div>
        </div>
      ) : showLabel ? (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-xs" style={{ color: tierColor }}>{tierLabel}</span>
          <span style={{ color, fontWeight: 700, fontSize: 13 }}>
            {capped}%
          </span>
        </div>
      ) : null}
      <div
        className={`relative w-full overflow-hidden rounded-full ${trackH}`}
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${capped}%`,
            background: gradient,
            boxShadow: glow,
          }}
        />
      </div>
      {showLabel && size === 'lg' && backers !== undefined && threshold !== undefined && (
        <div className="mt-2 flex justify-between text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <span>0</span>
          <span style={{ color, fontWeight: 600 }}>{threshold} needed</span>
        </div>
      )}
    </div>
  );
}
