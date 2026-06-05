import { Flame } from 'lucide-react';
import { TIER_COLORS, TIER_LABELS } from './types';
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
    : 'linear-gradient(90deg, #f97316, #ff4d2e)';
  const glow = status === 'cancelled' ? 'none' : '0 0 12px rgba(255,77,46,0.3)';

  const trackH = size === 'sm' ? 'h-2' : size === 'lg' ? 'h-4.5' : 'h-3';
  const tierLabel = `Tier ${t + 1} · ${TIER_LABELS[t]}`;
  const showFlame = capped >= 100 && status !== 'cancelled';
  const flameSize = size === 'sm' ? 16 : size === 'lg' ? 32 : 26;

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
      <div className="relative w-full">
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
        {showFlame && (
          <div
            className="pointer-events-none absolute"
            style={{ right: -2, bottom: 0, filter: 'drop-shadow(0 0 6px rgba(255,107,46,0.9))' }}
          >
            <span className="animate-flicker block">
              <Flame size={flameSize} color="#ff4d2e" fill="#ff7a45" strokeWidth={2} />
            </span>
          </div>
        )}
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