export const initialBookingItems = [
  item('bi-jamie-e2', 'b-jamie-e2', 'pt2e', 2, 10),
  item('bi-seed-e1', 'b-seed-e1', 'pt1e', 156, 12),
  item('bi-seed-e2', 'b-seed-e2', 'pt2e', 124, 10),
  item('bi-seed-e3e', 'b-seed-e3', 'pt3e', 80, 18),
  item('bi-seed-e3m', 'b-seed-e3', 'pt3m', 12, 32),
  item('bi-seed-e4', 'b-seed-e4', 'pt4e', 27, 15),
  item('bi-seed-e5', 'b-seed-e5', 'pt5e', 115, 16),
  item('bi-seed-e6', 'b-seed-e6', 'pt6e', 11, 8),
];

function item(id, bookingId, priceStatusId, quantity, unitPrice) {
  return { id, bookingId, priceStatusId, quantity, unitPrice, subtotal: quantity * unitPrice, createdAt: '2026-06-02T00:00:00.000Z' };
}
