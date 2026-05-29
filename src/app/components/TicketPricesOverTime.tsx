type Tier = { label: string; price: number; qty: number; sold: number };

const SEGMENTS = [
  { bg: '#00f991', text: '#000' },
  { bg: '#fee900', text: '#000' },
  { bg: '#f46303', text: '#000' },
  { bg: '#ff0a0a', text: '#fff' },
];

export function TicketPricesOverTime({ tiers }: { tiers: Tier[] }) {
  const segments = tiers.slice(0, 4);
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
        Ticket prices over time
      </div>
      <div
        className="flex items-stretch overflow-hidden"
        style={{ border: '1px solid #000', borderRadius: 20, height: 36 }}
      >
        {segments.map((t, i) => {
          const style = SEGMENTS[i] ?? SEGMENTS[SEGMENTS.length - 1];
          const isLast = i === segments.length - 1;
          return (
            <div
              key={i}
              className="flex flex-1 items-center justify-center text-sm font-medium"
              style={{ background: style.bg, color: style.text }}
            >
              {isLast ? `$${t.price} flat` : `$${t.price}`}
            </div>
          );
        })}
      </div>
    </div>
  );
}
