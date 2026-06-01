-- ============================================================================
-- SQL Seed Data for party.fun Database Setup
-- Run these commands in your Supabase SQL Editor to populate mock events.
-- ============================================================================

-- 1. Create Mock Organizer Profiles
INSERT INTO public.profiles (id, full_name, email, role, student_id) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'NUS Electronic Music Club', 'emc@u.nus.edu', 'admin', 'A0000001A'),
  ('d1000000-0000-0000-0000-000000000002', 'NTU Cultural Council', 'cultural@u.ntu.edu', 'admin', 'A0000002B'),
  ('d1000000-0000-0000-0000-000000000003', 'SMU Photography Society', 'photosoc@u.smu.edu', 'admin', 'A0000003C'),
  ('d1000000-0000-0000-0000-000000000004', 'SUTD Dev Society', 'devsoc@u.sutd.edu', 'admin', 'A0000004D'),
  ('d1000000-0000-0000-0000-000000000005', 'NUS Adventure Club', 'adventure@u.nus.edu', 'admin', 'A0000005E'),
  ('d1000000-0000-0000-0000-000000000006', 'SMU Writers Guild', 'writers@u.smu.edu', 'admin', 'A0000006F')
ON CONFLICT (id) DO NOTHING;

-- 2. Create Mock Events
INSERT INTO public.events (id, title, organiser_id, description, start_time, location, image_url, backers_threshold, hard_capacity, status, deadline) VALUES
  (
    'e1000000-0000-0000-0000-000000000001',
    'Neon Jungle: Freshers Rave',
    'd1000000-0000-0000-0000-000000000001',
    'A night of bass-heavy beats, UV body paint and free-flow mocktails. Capping our orientation week with the loudest party on campus.',
    '2026-06-12 22:00:00+08',
    'The Projector, Golden Mile Tower',
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80&auto=format&fit=crop',
    200,
    400,
    'funding',
    '2026-06-10 23:59:00+08'
  ),
  (
    'e1000000-0000-0000-0000-000000000002',
    'CCA Mashup: Inter-Club Block Party',
    'd1000000-0000-0000-0000-000000000002',
    'Eight clubs, one yard. Live bands, dance crews, food trucks and a glow-stick finale.',
    '2026-06-20 19:00:00+08',
    'NTU North Spine Plaza',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&q=80&auto=format&fit=crop',
    300,
    800,
    'funding',
    '2026-06-18 20:00:00+08'
  ),
  (
    'e1000000-0000-0000-0000-000000000003',
    'Rooftop Sundown Sessions',
    'd1000000-0000-0000-0000-000000000003',
    'Golden-hour cocktails, lo-fi DJ sets and skyline views. Strictly limited capacity.',
    '2026-06-28 17:30:00+08',
    'Concourse Building, Level 12',
    'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=1200&q=80&auto=format&fit=crop',
    80,
    120,
    'greenlit',
    '2026-06-25 18:00:00+08'
  ),
  (
    'e1000000-0000-0000-0000-000000000004',
    'Hackathon Afterglow',
    'd1000000-0000-0000-0000-000000000004',
    'Forty-eight hours of code, one night of catharsis. Open bar for finalists.',
    '2026-07-05 21:00:00+08',
    'Tanjong Pagar Distripark',
    'https://images.unsplash.com/photo-1571266028243-d220c6a23f37?w=1200&q=80&auto=format&fit=crop',
    150,
    300,
    'funding',
    '2026-07-03 23:59:00+08'
  ),
  (
    'e1000000-0000-0000-0000-000000000005',
    'Silent Disco @ Sentosa',
    'd1000000-0000-0000-0000-000000000005',
    'Three channels, one beach, zero noise complaints. Headphones provided.',
    '2026-07-11 20:00:00+08',
    'Tanjong Beach, Sentosa',
    'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=1200&q=80&auto=format&fit=crop',
    180,
    250,
    'funding',
    '2026-07-09 21:00:00+08'
  ),
  (
    'e1000000-0000-0000-0000-000000000006',
    'Open Mic & Lo-Fi Lounge',
    'd1000000-0000-0000-0000-000000000006',
    'Spoken word, acoustic sets and shared playlists. BYO notebooks.',
    '2026-07-17 19:30:00+08',
    'The Hangar, SMU Connexion',
    'https://images.unsplash.com/photo-1485579149621-3123dd979885?w=1200&q=80&auto=format&fit=crop',
    120,
    200,
    'failed',
    '2026-07-15 20:00:00+08'
  )
ON CONFLICT (id) DO NOTHING;

-- 3. Create Mock Pricing Tiers
INSERT INTO public.pricing_tiers (event_id, tier_index, label, price, max_spots) VALUES
  -- Event 1 Tiers
  ('e1000000-0000-0000-0000-000000000001', 0, 'Super Early', 12.00, 50),
  ('e1000000-0000-0000-0000-000000000001', 1, 'Early', 18.00, 100),
  ('e1000000-0000-0000-0000-000000000001', 2, 'Standard', 25.00, 150),
  ('e1000000-0000-0000-0000-000000000001', 3, 'Greenlit Door', 32.00, 100),

  -- Event 2 Tiers
  ('e1000000-0000-0000-0000-000000000002', 0, 'Super Early', 10.00, 200),
  ('e1000000-0000-0000-0000-000000000002', 1, 'Early', 14.00, 200),
  ('e1000000-0000-0000-0000-000000000002', 2, 'Standard', 20.00, 300),
  ('e1000000-0000-0000-0000-000000000002', 3, 'Greenlit Door', 25.00, 100),

  -- Event 3 Tiers
  ('e1000000-0000-0000-0000-000000000003', 0, 'Super Early', 18.00, 30),
  ('e1000000-0000-0000-0000-000000000003', 1, 'Early', 24.00, 40),
  ('e1000000-0000-0000-0000-000000000003', 2, 'Standard', 28.00, 30),
  ('e1000000-0000-0000-0000-000000000003', 3, 'Greenlit Door', 35.00, 20),

  -- Event 4 Tiers
  ('e1000000-0000-0000-0000-000000000004', 0, 'Super Early', 15.00, 80),
  ('e1000000-0000-0000-0000-000000000004', 1, 'Early', 20.00, 80),
  ('e1000000-0000-0000-0000-000000000004', 2, 'Standard', 26.00, 100),
  ('e1000000-0000-0000-0000-000000000004', 3, 'Greenlit Door', 32.00, 40),

  -- Event 5 Tiers
  ('e1000000-0000-0000-0000-000000000005', 0, 'Super Early', 16.00, 60),
  ('e1000000-0000-0000-0000-000000000005', 1, 'Early', 22.00, 80),
  ('e1000000-0000-0000-0000-000000000005', 2, 'Standard', 28.00, 80),
  ('e1000000-0000-0000-0000-000000000005', 3, 'Greenlit Door', 35.00, 30),

  -- Event 6 Tiers
  ('e1000000-0000-0000-0000-000000000006', 0, 'Super Early', 8.00, 60),
  ('e1000000-0000-0000-0000-000000000006', 1, 'Early', 12.00, 60),
  ('e1000000-0000-0000-0000-000000000006', 2, 'Standard', 16.00, 60),
  ('e1000000-0000-0000-0000-000000000006', 3, 'Greenlit Door', 20.00, 20)
ON CONFLICT (event_id, tier_index) DO NOTHING;

-- 4. Create Mock Pledges to match the exact backer numbers
-- Helper inserts to match backers counts dynamically through aggregation
INSERT INTO public.pledges (event_id, user_id, amount_paid, quantity, status)
SELECT 
  'e1000000-0000-0000-0000-000000000001', 
  'd1000000-0000-0000-0000-000000000002', 
  18.00, 
  156, -- Set 156 spots sold
  'locked'
WHERE NOT EXISTS (SELECT 1 FROM public.pledges WHERE event_id = 'e1000000-0000-0000-0000-000000000001');

INSERT INTO public.pledges (event_id, user_id, amount_paid, quantity, status)
SELECT 
  'e1000000-0000-0000-0000-000000000002', 
  'd1000000-0000-0000-0000-000000000001', 
  10.00, 
  126, -- Set 126 spots sold
  'locked'
WHERE NOT EXISTS (SELECT 1 FROM public.pledges WHERE event_id = 'e1000000-0000-0000-0000-000000000002');

INSERT INTO public.pledges (event_id, user_id, amount_paid, quantity, status)
SELECT 
  'e1000000-0000-0000-0000-000000000003', 
  'd1000000-0000-0000-0000-000000000004', 
  28.00, 
  92, -- Set 92 spots sold
  'locked'
WHERE NOT EXISTS (SELECT 1 FROM public.pledges WHERE event_id = 'e1000000-0000-0000-0000-000000000003');

INSERT INTO public.pledges (event_id, user_id, amount_paid, quantity, status)
SELECT 
  'e1000000-0000-0000-0000-000000000004', 
  'd1000000-0000-0000-0000-000000000005', 
  15.00, 
  27, -- Set 27 spots sold
  'locked'
WHERE NOT EXISTS (SELECT 1 FROM public.pledges WHERE event_id = 'e1000000-0000-0000-0000-000000000004');

INSERT INTO public.pledges (event_id, user_id, amount_paid, quantity, status)
SELECT 
  'e1000000-0000-0000-0000-000000000005', 
  'd1000000-0000-0000-0000-000000000003', 
  22.00, 
  115, -- Set 115 spots sold
  'locked'
WHERE NOT EXISTS (SELECT 1 FROM public.pledges WHERE event_id = 'e1000000-0000-0000-0000-000000000005');

INSERT INTO public.pledges (event_id, user_id, amount_paid, quantity, status)
SELECT 
  'e1000000-0000-0000-0000-000000000006', 
  'd1000000-0000-0000-0000-000000000001', 
  8.00, 
  11, -- Set 11 spots sold
  'locked'
WHERE NOT EXISTS (SELECT 1 FROM public.pledges WHERE event_id = 'e1000000-0000-0000-0000-000000000006');
