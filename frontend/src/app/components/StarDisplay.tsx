import { Star } from 'lucide-react';

export const GOLD = '#ffcb3c';

// Read-only star row for a submitted review. Shared by the review list and the
// landing-page testimonials carousel, which wants larger stars than the default.
export function StarDisplay({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} color={n <= rating ? GOLD : 'var(--muted-foreground)'} fill={n <= rating ? GOLD : 'none'} />
      ))}
    </div>
  );
}
