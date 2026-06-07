export const initialPriceStatuses = [
  status('pt1e', 'e1', 'early_bird', 12, 200), status('pt1m', 'e1', 'greenlit', 22, 200),
  status('pt2e', 'e2', 'early_bird', 10, 300), status('pt2m', 'e2', 'greenlit', 18, 500),
  status('pt3e', 'e3', 'early_bird', 18, 80), status('pt3m', 'e3', 'greenlit', 32, 40),
  status('pt4e', 'e4', 'early_bird', 15, 150), status('pt4m', 'e4', 'greenlit', 27, 150),
  status('pt5e', 'e5', 'early_bird', 16, 180), status('pt5m', 'e5', 'greenlit', 29, 70),
  status('pt6e', 'e6', 'early_bird', 8, 120), status('pt6m', 'e6', 'greenlit', 14, 80),
];

function status(id, eventId, statusName, price, ticketCapacity) {
  return { id, eventId, statusName, price, ticketCapacity, createdAt: '2026-06-01T00:00:00.000Z' };
}
