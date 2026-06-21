import { TrendingDown, TrendingUp } from 'lucide-react';
import type { EventItem } from './types';

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

export function HypePricingPanel({ event, estimatedTotal, qty }: {
  event: EventItem;
  estimatedTotal?: string | null;
  qty?: number;
}) {
  if (!event.hypeDrivenPricing || event.basePrice == null || event.maxPrice == null) return null;

  const live = event.currentDynamicPrice ?? event.price;
  const base = event.basePrice;
  const max = event.maxPrice;

  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: 'rgba(255,77,46,0.25)', background: 'rgba(255,77,46,0.06)' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider" style={{ color: '#ff8a66', fontWeight: 700 }}>Hype-driven pricing</div>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Price rises as tickets are pledged and drops when tickets are given away.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Live ticket price</div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>{fmt(live)}</div>
        </div>
      </div>

      <div className="mb-3 flex items-stretch overflow-hidden rounded-xl" style={{ height: 36, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex flex-1 items-center justify-center text-xs font-semibold" style={{ background: '#29e07a', color: '#0b0b0f' }}>
          {fmt(base)} base
        </div>
        <div className="flex flex-[2] items-center justify-center text-[10px] uppercase tracking-wide" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--muted-foreground)' }}>
          bonding curve · {event.activeTicketCount}/{event.maxCapacity} pledged
        </div>
        <div className="flex flex-1 items-center justify-center text-xs font-semibold" style={{ background: '#ff4d2e', color: '#fff' }}>
          {fmt(max)} max
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          <TrendingUp size={14} className="mt-0.5 shrink-0" style={{ color: '#ffcb3c' }} />
          <span style={{ color: 'var(--muted-foreground)' }}>Each new pledge pushes the price up along the curve.</span>
        </div>
        <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          <TrendingDown size={14} className="mt-0.5 shrink-0" style={{ color: '#29e07a' }} />
          <span style={{ color: 'var(--muted-foreground)' }}>Give-aways release spots and lower the price for the next buyer.</span>
        </div>
      </div>

      {estimatedTotal && qty != null && qty > 0 && (
        <div className="mt-4 flex items-baseline justify-between rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Estimated total for {qty} ticket{qty === 1 ? '' : 's'}</span>
          <span style={{ fontWeight: 800, fontSize: 18 }}>{estimatedTotal}</span>
        </div>
      )}
    </div>
  );
}

export function EventSettingsPricingCard({ event }: { event: EventItem }) {
  if (!event.hypeDrivenPricing || event.basePrice == null || event.maxPrice == null) return null;

  return (
    <div className="rounded-2xl glass p-6 transition-all duration-300">
      <h3 className="mb-1">Event settings</h3>
      <p className="mb-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>Hype-driven pricing parameters for this event.</p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          <dt className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Base price (P<sub>base</sub>)</dt>
          <dd className="mt-1" style={{ fontWeight: 700 }}>${event.basePrice.toFixed(2)}</dd>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          <dt className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Max price (P<sub>max</sub>)</dt>
          <dd className="mt-1" style={{ fontWeight: 700 }}>${event.maxPrice.toFixed(2)}</dd>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          <dt className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Capacity (C)</dt>
          <dd className="mt-1" style={{ fontWeight: 700 }}>{event.maxCapacity}</dd>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          <dt className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Live ticket price</dt>
          <dd className="mt-1" style={{ fontWeight: 700 }}>${(event.currentDynamicPrice ?? event.price).toFixed(2)}</dd>
        </div>
      </dl>
    </div>
  );
}
