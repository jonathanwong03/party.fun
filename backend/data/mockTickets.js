import { initialBookingItems } from './mockBookingItems.js';

export const initialTickets = initialBookingItems.flatMap((item) =>
  Array.from({ length: item.quantity }, (_, index) => ({
    id: `t-${item.id}-${index + 1}`,
    bookingId: item.bookingId,
    bookingItemId: item.id,
    qrCode: `PF-${item.id}-${index + 1}`,
    status: 'active',
    givenAwayAt: null,
    refundedAt: null,
    usedAt: null,
    createdAt: '2026-06-02T00:00:00.000Z',
  })),
);
