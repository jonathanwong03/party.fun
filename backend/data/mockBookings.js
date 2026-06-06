export const initialBookings = [
  booking('b-jamie-e2', 'mock-user-jamie', 'e2', 20),
  ...[
    ['b-seed-e1', 'e1', 1872],
    ['b-seed-e2', 'e2', 1240],
    ['b-seed-e3', 'e3', 1824],
    ['b-seed-e4', 'e4', 405],
    ['b-seed-e5', 'e5', 1840],
    ['b-seed-e6', 'e6', 88],
  ].map(([id, eventId, amountPaid]) => booking(id, 'seed-community', eventId, amountPaid)),
];

function booking(id, userId, eventId, amountPaid) {
  return { id, userId, eventId, amountPaid, refundedAmount: 0, status: 'captured', capturedAt: '2026-06-02T00:00:00.000Z', refundedAt: null, deletedAt: null, createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-02T00:00:00.000Z' };
}
