type Tier = { label: string; price: number; qty: number; sold: number };

const SEGMENTS = [
  { bg: '#00f991', text: '#000000' },
  { bg: '#fee900', text: '#000000' },
  { bg: '#f46303', text: '#000000' },
  { bg: '#ff0a0a', text: '#ffffff' },
];

export function TicketPricesOverTime({ tiers }: { tiers: Tier[] }) {
  const segments = tiers.slice(0, 4);
  return (
    <div>
      <div className="mb-3 text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--muted-foreground)', letterSpacing: '1px' }}>
        Ticket pricing curve
      </div>
      <div
        className="flex items-stretch overflow-hidden p-[2px] bg-black/35"
        style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, height: 40 }}
      >
        {segments.map((t, i) => {
          const style = SEGMENTS[i] ?? SEGMENTS[SEGMENTS.length - 1];
          const isLast = i === segments.length - 1;
          const isFirst = i === 0;
          return (
            <div
              key={i}
              className="flex flex-1 items-center justify-center text-sm font-medium transition-all duration-300"
              style={{ 
                background: style.bg, 
                color: style.text,
                borderRadius: isFirst ? '18px 0 0 18px' : isLast ? '0 18px 18px 0' : '0'
              }}
            >
              {isLast ? `$${t.price} flat` : `$${t.price}`}
            </div>
          );
        })}
      </div>
    </div>
  );
}
