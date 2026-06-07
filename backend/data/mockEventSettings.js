export const initialEventSettings = [
  settings('es1', 'e1', 200, 400, '2026-06-10T23:59:00+08:00'),
  settings('es2', 'e2', 300, 800, '2026-06-18T20:00:00+08:00'),
  settings('es3', 'e3', 80, 120, '2026-06-25T18:00:00+08:00'),
  settings('es4', 'e4', 150, 300, '2026-07-03T23:59:00+08:00'),
  settings('es5', 'e5', 180, 250, '2026-07-09T21:00:00+08:00'),
  settings('es6', 'e6', 120, 200, '2026-07-15T20:00:00+08:00'),
];

function settings(id, eventId, hypeThreshold, maxCapacity, deadline) {
  return { id, eventId, hypeThreshold, maxCapacity, deadline, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' };
}
