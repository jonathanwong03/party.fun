export const initialPriceTiers = [
  tier('pt1e', 'e1', 'early_bird', 12, 200), tier('pt1m', 'e1', 'greenlit', 22, 200),
  tier('pt2e', 'e2', 'early_bird', 10, 300), tier('pt2m', 'e2', 'greenlit', 18, 500),
  tier('pt3e', 'e3', 'early_bird', 18, 80), tier('pt3m', 'e3', 'greenlit', 32, 40),
  tier('pt4e', 'e4', 'early_bird', 15, 150), tier('pt4m', 'e4', 'greenlit', 27, 150),
  tier('pt5e', 'e5', 'early_bird', 16, 180), tier('pt5m', 'e5', 'greenlit', 29, 70),
  tier('pt6e', 'e6', 'early_bird', 8, 120), tier('pt6m', 'e6', 'greenlit', 14, 80),
];

function tier(id, eventId, tierName, price, ticketCapacity) {
  return { id, eventId, tierName, price, ticketCapacity, createdAt: '2026-06-01T00:00:00.000Z' };
}
