-- party.fun demo cleanup — removes ALL demo events and everything attached to them.
-- Paste into the Supabase SQL editor when you're done testing.
-- Targets this seed's fixed demo IDs AND any legacy "[DEMO] ..." titled events.
-- Real (non-demo) events are untouched.

CREATE TEMP VIEW demo_target_events AS
  SELECT id FROM public."EVENT"
  WHERE title LIKE '[DEMO]%'
     OR id = ANY (ARRAY[
       '0de00001-0000-4000-8000-000000000001','0de00002-0000-4000-8000-000000000002',
       '0de00003-0000-4000-8000-000000000003','0de00004-0000-4000-8000-000000000004',
       '0de00005-0000-4000-8000-000000000005','0de00006-0000-4000-8000-000000000006',
       '0de00007-0000-4000-8000-000000000007','0de00008-0000-4000-8000-000000000008',
       '0de00009-0000-4000-8000-000000000009','0de00010-0000-4000-8000-000000000010',
       '0de00011-0000-4000-8000-000000000011','0de00012-0000-4000-8000-000000000012',
       '0de00013-0000-4000-8000-000000000013','0de00014-0000-4000-8000-000000000014',
       '0de00015-0000-4000-8000-000000000015','0de00016-0000-4000-8000-000000000016'
     ]::uuid[]);

DELETE FROM public."EVENT_CO_ORGANISER_INVITES" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."TICKETS" WHERE "bookingId" IN (SELECT id FROM public."BOOKINGS" WHERE "eventId" IN (SELECT id FROM demo_target_events));
DELETE FROM public."BOOKING_ITEMS" WHERE "bookingId" IN (SELECT id FROM public."BOOKINGS" WHERE "eventId" IN (SELECT id FROM demo_target_events));
DELETE FROM public."BOOKINGS" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."WALLET_TRANSACTIONS" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."PRICE_STATUSES" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."EVENT_SETTINGS" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."EVENT" WHERE id IN (SELECT id FROM demo_target_events);

DROP VIEW demo_target_events;
