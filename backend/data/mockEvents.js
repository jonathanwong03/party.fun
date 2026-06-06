export const initialEvents = [
  event('e1', 'host-nus-emc', 'Neon Jungle: Freshers Rave', 'A night of bass-heavy beats, UV body paint and free-flow mocktails. Capping our orientation week with the loudest party on campus.', 'The Projector, Golden Mile Tower', '2026-06-12T22:00:00+08:00', '2026-06-13T02:00:00+08:00', 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80&auto=format&fit=crop', 'pending', 'early_bird'),
  event('e2', 'host-ntu-cultural', 'CCA Mashup: Inter-Club Block Party', 'Eight clubs, one yard. Live bands, dance crews, food trucks and a glow-stick finale.', 'NTU North Spine Plaza', '2026-06-20T19:00:00+08:00', '2026-06-20T23:00:00+08:00', 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&q=80&auto=format&fit=crop', 'pending', 'early_bird'),
  event('e3', 'mock-organiser-smu', 'Rooftop Sundown Sessions', 'Golden-hour cocktails, lo-fi DJ sets and skyline views. Strictly limited capacity.', 'Concourse Building, Level 12', '2026-06-28T17:30:00+08:00', '2026-06-28T20:30:00+08:00', 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=1200&q=80&auto=format&fit=crop', 'greenlit', 'main_crowd', '2026-06-20T10:00:00.000Z'),
  event('e4', 'host-sutd-dev', 'Hackathon Afterglow', 'Forty-eight hours of code, one night of catharsis. Open bar for finalists.', 'Tanjong Pagar Distripark', '2026-07-05T21:00:00+08:00', '2026-07-06T01:00:00+08:00', 'https://images.unsplash.com/photo-1571266028243-d220c6a23f37?w=1200&q=80&auto=format&fit=crop', 'pending', 'early_bird'),
  event('e5', 'host-nus-adventure', 'Silent Disco @ Sentosa', 'Three channels, one beach, zero noise complaints. Headphones provided.', 'Tanjong Beach, Sentosa', '2026-07-11T20:00:00+08:00', '2026-07-11T23:00:00+08:00', 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=1200&q=80&auto=format&fit=crop', 'pending', 'early_bird'),
  { ...event('e6', 'host-smu-writers', 'Open Mic & Lo-Fi Lounge', 'Spoken word, acoustic sets and shared playlists. BYO notebooks.', 'The Hangar, SMU Connexion', '2026-07-17T19:30:00+08:00', '2026-07-17T22:30:00+08:00', 'https://images.unsplash.com/photo-1485579149621-3123dd979885?w=1200&q=80&auto=format&fit=crop', 'cancelled', 'early_bird'), cancelledAt: '2026-06-05T00:00:00.000Z', cancellationReason: 'organiser_cancelled' },
];

function event(id, hostId, title, description, location, startDate, endDate, imageUrl, status, currentTierName, greenlitAt = null) {
  return {
    id,
    hostId,
    title,
    description,
    location,
    startDate,
    endDate,
    imageUrl,
    status,
    currentTierName,
    greenlitAt,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
