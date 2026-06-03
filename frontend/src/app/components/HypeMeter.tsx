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
  const gradient = status === 'cancelled' 
    ? '#5a5a66' 
    : pct >= 100 
      ? 'linear-gradient(90deg, #10b981, #059669)' 
      : 'linear-gradient(90deg, #f97316, #ff4d2e)';
  const glow = status === 'cancelled' ? 'none' : pct >= 100 ? '0 0 12px rgba(16,185,129,0.3)' : '0 0 12px rgba(255,77,46,0.3)';

  const trackH = size === 'sm' ? 'h-2' : size === 'lg' ? 'h-4.5' : 'h-3';
  const tierLabel = ['Tier 1 · Early believers', 'Tier 2 · Growing hype', 'Tier 3 · Almost there', 'Greenlit'][t];

  return (
    <div className="w-full">
      {showLabel && size === 'lg' ? (
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div style={{ fontSize: 36, fontWeight: 800, color, lineHeight: 1, fontFamily: "'Space Grotesk', sans-serif" }}>{capped}%</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {backers !== undefined && threshold !== undefined
                ? `${backers} of ${threshold} backers`
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
          <span style={{ color, fontWeight: 700, fontSize: 13, fontFamily: "'Space Grotesk', sans-serif" }}>
            {capped}%
          </span>
        </div>
      ) : null}
      <div
        className={`relative w-full overflow-hidden rounded-full ${trackH} border border-white/5`}
        style={{ background: 'rgba(0, 0, 0, 0.4)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
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