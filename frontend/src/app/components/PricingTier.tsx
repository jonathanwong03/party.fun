import { Check, Lock } from 'lucide-react';

const TIER_COLORS = ['#29e07a', '#ffcb3c', '#ff8a2e', '#ff3354'] as const;

export function PricingTier({
  tiers,
  activeIndex,
}: {
  tiers: { label: string; price: number; qty: number; sold: number; fillPct?: number }[];
  activeIndex: number;
}) {
  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="mb-4 flex items-baseline justify-between">
        <h3>Bonding curve</h3>
        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Buy early, pay less</span>
      </div>

      {/* Rising bar chart */}
      <div className="mb-5 flex items-end gap-1.5 px-1">
        {tiers.map((t, i) => {
          // Fill % is computed by the backend; fall back to a local calc if absent.
          const fillPct = t.fillPct ?? (t.qty === 0 ? 0 : (t.sold / t.qty) * 100);
          const done = i < activeIndex;
          const active = i === activeIndex;
          const color = done ? TIER_COLORS[i] : active ? TIER_COLORS[i] : '#2a2a35';
          const maxH = 28 + i * 18;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="text-[10px]" style={{ color: active ? TIER_COLORS[i] : 'var(--muted-foreground)', fontWeight: active ? 700 : 400 }}>
                ${t.price}
              </div>
              <div
                className="relative w-full overflow-hidden rounded-t-md"
                style={{ height: maxH, background: 'var(--surface-2)', border: active ? `1px solid ${TIER_COLORS[i]}40` : '1px solid transparent' }}
              >
                <div
                  className="absolute bottom-0 left-0 w-full rounded-t-sm transition-all duration-700"
                  style={{
                    height: `${Math.max(done ? 100 : fillPct, done ? 100 : fillPct)}%`,
                    background: done
                      ? `linear-gradient(180deg, ${TIER_COLORS[i]}cc, ${TIER_COLORS[i]}66)`
                      : active
                      ? `linear-gradient(180deg, ${TIER_COLORS[i]}, ${TIER_COLORS[i]}88)`
                      : 'transparent',
                    boxShadow: active ? `0 0 12px ${TIER_COLORS[i]}55` : 'none',
                  }}
                />
                {active && fillPct > 0 && (
                  <div
                    className="absolute inset-x-0 bottom-0"
                    style={{
                      height: `${fillPct}%`,
                      background: `linear-gradient(180deg, ${TIER_COLORS[i]}, ${TIER_COLORS[i]}99)`,
                      boxShadow: `0 0 14px ${TIER_COLORS[i]}66`,
                    }}
                  />
                )}
              </div>
              <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                Tier {i + 1}
              </div>
            </div>
          );
        })}
      </div>

      <ul className="space-y-2">
        {tiers.map((t, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          const color = TIER_COLORS[i];
          return (
            <li
              key={i}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm"
              style={{
                background: active ? `${color}10` : 'transparent',
                border: active ? `1px solid ${color}35` : '1px solid transparent',
              }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="grid size-5 place-items-center rounded-full"
                  style={{
                    background: done ? color : active ? color : 'var(--surface-2)',
                    color: done || active ? '#0b0b0f' : 'var(--muted-foreground)',
                  }}
                >
                  {done ? <Check size={11} /> : active ? '•' : <Lock size={9} />}
                </span>
                <div>
                  <div style={{ color: done || active ? 'var(--foreground)' : 'var(--muted-foreground)', fontWeight: 500 }}>{t.label}</div>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{t.sold}/{t.qty} sold</div>
                </div>
                {active && (
                  <span className="rounded-full px-2 py-0.5 text-[9px]" style={{ background: color, color: '#0b0b0f', fontWeight: 800, letterSpacing: '0.05em' }}>
                    LIVE
                  </span>
                )}
              </div>
              <span style={{ fontWeight: 800, fontSize: 16, color: done || active ? 'var(--foreground)' : '#5a5a66' }}>
                ${t.price}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
