-- Resettable party.fun demo seed.
-- Paste this into the Supabase SQL editor after applying 20260623_coorganisers.sql.
-- Re-running it is safe: it removes the previous demo data and recreates it.
--
-- Demo events use clean display names (e.g. "Rooftop Mixer") but are identified
-- internally by a fixed set of UUIDs (see demo_events below), so reset/cleanup do
-- NOT depend on the title. Legacy "[DEMO] ..." rows from older seeds are also
-- cleared on the first re-run. To remove everything later, run demo_cleanup.sql.
--
-- Demo organiser: partyfundemo@gmail.com   Demo users: user@smu.edu.sg, user2@smu.edu.sg

DO $$
declare missing_accounts text;
begin
  select string_agg(email, ', ') into missing_accounts
  from (
    select unnest(array[
      'partyfundemo@gmail.com',
      'organiser@smu.edu.sg',
      'user2@smu.edu.sg',
      'user@smu.edu.sg'
    ]) as email
    except
    select email from public."USER"
  ) m;

  if missing_accounts is not null then
    raise exception 'Missing required demo account(s): %', missing_accounts;
  end if;
end $$;

-- ── Demo definitions (fixed IDs + clean titles + per-event images) ────────────
DROP TABLE IF EXISTS demo_events;
CREATE TEMP TABLE demo_events (
  code text PRIMARY KEY,
  id uuid NOT NULL,
  host_email text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  location text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  early_price numeric NOT NULL,
  greenlit_price numeric NOT NULL,
  threshold int NOT NULL,
  max_capacity int NOT NULL,
  status text NOT NULL,
  image_url text NOT NULL
);

INSERT INTO demo_events(code, id, host_email, title, description, location, start_at, end_at, deadline_at, early_price, greenlit_price, threshold, max_capacity, status, image_url) VALUES
('PFD-01','0de00001-0000-4000-8000-000000000001','partyfundemo@gmail.com','Block Party','Co-host demo event. organiser@smu.edu.sg has a pending invite to co-organise this one.','NTU North Spine Plaza', now()+interval '8 days', now()+interval '8 days 4 hours', now()+interval '6 days', 10, 16, 10, 30, 'early_bird','https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=80'),
('PFD-02','0de00002-0000-4000-8000-000000000002','partyfundemo@gmail.com','Rooftop Mixer','Use this event to demonstrate editing an owned event.','SMU Connexion Rooftop', now()+interval '11 days', now()+interval '11 days 3 hours', now()+interval '9 days', 12, 20, 10, 26, 'early_bird','https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=1200&q=80'),
('PFD-03','0de00003-0000-4000-8000-000000000003','partyfundemo@gmail.com','Empty Workshop','Empty owned event for the delete/cancel walkthrough.','Library Project Room', now()+interval '13 days', now()+interval '13 days 2 hours', now()+interval '10 days', 8, 14, 8, 20, 'early_bird','https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80'),
('PFD-04','0de00004-0000-4000-8000-000000000004','partyfundemo@gmail.com','Greenlit Bash','Greenlit event happening now for the ticket check-in demo.','Campus Green Lawn', now()-interval '1 hour', now()+interval '3 hours', now()-interval '2 days', 15, 24, 10, 24, 'greenlit','https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80'),
('PFD-05','0de00005-0000-4000-8000-000000000005','partyfundemo@gmail.com','Arcade Night','user@smu.edu.sg should buy from this event during the demo.','Bugis Arcade Hall', now()+interval '15 days', now()+interval '15 days 4 hours', now()+interval '12 days', 9, 15, 10, 28, 'early_bird','https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80'),
('PFD-06','0de00006-0000-4000-8000-000000000006','partyfundemo@gmail.com','Silent Disco','user@smu.edu.sg already has active tickets here and can give all away for no refund.','Esplanade Annexe Studio', now()+interval '16 days', now()+interval '16 days 3 hours', now()+interval '13 days', 11, 18, 10, 25, 'early_bird','https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80'),
('PFD-07','0de00007-0000-4000-8000-000000000007','partyfundemo@gmail.com','Rooftop Snacks','Appears in user@smu.edu.sg cancelled joined-events tab (all tickets already given away).','Raffles Hall Rooftop', now()+interval '17 days', now()+interval '17 days 2 hours', now()+interval '14 days', 7, 12, 10, 25, 'early_bird','https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80'),
('PFD-08','0de00008-0000-4000-8000-000000000008','partyfundemo@gmail.com','Poolside Reset','Owner can cancel this wallet-paid event to demonstrate automatic refunds. Also has a declined invite.','Poolside Terrace', now()+interval '18 days', now()+interval '18 days 3 hours', now()+interval '15 days', 14, 22, 10, 24, 'early_bird','https://images.unsplash.com/photo-1531219432768-9f540ce91ef8?auto=format&fit=crop&w=1200&q=80'),
('SMU-01','0de00009-0000-4000-8000-000000000009','organiser@smu.edu.sg','Study Break Social','partyfundemo@gmail.com is already accepted as a co-organiser for this event.','SOE Basement Lounge', now()+interval '9 days', now()+interval '9 days 3 hours', now()+interval '7 days', 10, 17, 10, 25, 'early_bird','https://images.unsplash.com/photo-1521017432531-fbd92d768814?auto=format&fit=crop&w=1200&q=80'),
('SMU-02','0de00010-0000-4000-8000-000000000010','organiser@smu.edu.sg','Concourse Jam','Use this event to demonstrate editing for organiser@smu.edu.sg.','Concourse Building', now()+interval '12 days', now()+interval '12 days 3 hours', now()+interval '9 days', 13, 21, 10, 26, 'early_bird','https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?auto=format&fit=crop&w=1200&q=80'),
('SMU-03','0de00011-0000-4000-8000-000000000011','organiser@smu.edu.sg','Empty CCA Briefing','Empty owned event for the delete/cancel walkthrough.','Seminar Room 3.2', now()+interval '14 days', now()+interval '14 days 2 hours', now()+interval '11 days', 8, 13, 8, 18, 'early_bird','https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1200&q=80'),
('SMU-04','0de00012-0000-4000-8000-000000000012','organiser@smu.edu.sg','Door Drill','Greenlit event happening now. One ticket is already used, so rescanning it shows the already-checked-in error.','T-Junction Atrium', now()-interval '30 minutes', now()+interval '2 hours', now()-interval '2 days', 16, 25, 10, 22, 'greenlit','https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=1200&q=80'),
('SMU-05','0de00013-0000-4000-8000-000000000013','organiser@smu.edu.sg','Picnic Beats','user2@smu.edu.sg should buy from this event during the demo.','Fort Canning Picnic Slope', now()+interval '19 days', now()+interval '19 days 4 hours', now()+interval '16 days', 10, 18, 10, 28, 'early_bird','https://images.unsplash.com/photo-1526401485004-46910ecc8e51?auto=format&fit=crop&w=1200&q=80'),
('SMU-06','0de00014-0000-4000-8000-000000000014','organiser@smu.edu.sg','Makers Night','user2@smu.edu.sg already has active tickets here and can give all away for no refund.','Innovation Hub Studio', now()+interval '20 days', now()+interval '20 days 3 hours', now()+interval '17 days', 11, 19, 10, 25, 'early_bird','https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=1200&q=80'),
('SMU-07','0de00015-0000-4000-8000-000000000015','organiser@smu.edu.sg','Wellness Social','Appears in user2@smu.edu.sg cancelled joined-events tab (all tickets already given away).','Wellness Centre Deck', now()+interval '21 days', now()+interval '21 days 2 hours', now()+interval '18 days', 6, 12, 10, 24, 'early_bird','https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=80'),
('SMU-08','0de00016-0000-4000-8000-000000000016','organiser@smu.edu.sg','No More Spots','Full-capacity greenlit event for the failed-purchase demo (buying hits "not enough tickets").','Hall 5 Blackbox', now()+interval '22 days', now()+interval '22 days 3 hours', now()+interval '19 days', 18, 30, 10, 20, 'greenlit','https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1200&q=80');

DROP TABLE IF EXISTS demo_allocations;
CREATE TEMP TABLE demo_allocations (
  code text NOT NULL,
  user_email text NOT NULL,
  qty int NOT NULL,
  ticket_status text NOT NULL DEFAULT 'active',
  used_count int NOT NULL DEFAULT 0,
  booking_status text NOT NULL DEFAULT 'captured',
  payment_method text NOT NULL DEFAULT 'wallet'
);

INSERT INTO demo_allocations(code, user_email, qty, ticket_status, used_count, booking_status, payment_method) VALUES
('PFD-01','user@smu.edu.sg',4,'active',0,'captured','wallet'),
('PFD-02','user2@smu.edu.sg',3,'active',0,'captured','wallet'),
('PFD-04','user@smu.edu.sg',10,'active',0,'captured','wallet'),
('PFD-05','user2@smu.edu.sg',2,'active',0,'captured','wallet'),
('PFD-06','user@smu.edu.sg',2,'active',0,'captured','wallet'),
('PFD-07','user@smu.edu.sg',2,'given_away',0,'given_away','wallet'),
('PFD-08','user@smu.edu.sg',3,'active',0,'captured','wallet'),
('SMU-01','user2@smu.edu.sg',4,'active',0,'captured','wallet'),
('SMU-02','user@smu.edu.sg',2,'active',0,'captured','wallet'),
('SMU-04','user@smu.edu.sg',10,'active',1,'captured','wallet'),
('SMU-05','user@smu.edu.sg',2,'active',0,'captured','wallet'),
('SMU-06','user2@smu.edu.sg',2,'active',0,'captured','wallet'),
('SMU-07','user2@smu.edu.sg',2,'given_away',0,'given_away','wallet'),
('SMU-08','user2@smu.edu.sg',20,'active',0,'captured','wallet');

-- ── Reset: clear prior demo rows (this seed's fixed IDs + any legacy [DEMO] rows) ─
CREATE TEMP VIEW demo_target_events AS
  SELECT id FROM public."EVENT"
  WHERE title LIKE '[DEMO]%' OR id IN (SELECT id FROM demo_events);

DELETE FROM public."EVENT_CO_ORGANISER_INVITES" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."TICKETS" WHERE "bookingId" IN (SELECT id FROM public."BOOKINGS" WHERE "eventId" IN (SELECT id FROM demo_target_events));
DELETE FROM public."BOOKING_ITEMS" WHERE "bookingId" IN (SELECT id FROM public."BOOKINGS" WHERE "eventId" IN (SELECT id FROM demo_target_events));
DELETE FROM public."BOOKINGS" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."WALLET_TRANSACTIONS" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."PRICE_STATUSES" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."EVENT_SETTINGS" WHERE "eventId" IN (SELECT id FROM demo_target_events);
DELETE FROM public."EVENT" WHERE id IN (SELECT id FROM demo_target_events);
DROP VIEW demo_target_events;

-- ── Create the events ─────────────────────────────────────────────────────────
INSERT INTO public."EVENT"(id, "hostId", title, description, location, "startDate", "endDate", "imageUrl", status, "createdAt", "updatedAt")
SELECT d.id, u.id, d.title, d.description, d.location, d.start_at, d.end_at, d.image_url, d.status, now(), now()
FROM demo_events d
JOIN public."USER" u ON u.email = d.host_email;

INSERT INTO public."EVENT_SETTINGS"("eventId", "hypeThreshold", "maxCapacity", deadline, "createdAt", "updatedAt")
SELECT id, threshold, max_capacity, deadline_at, now(), now()
FROM demo_events;

INSERT INTO public."PRICE_STATUSES"("eventId", "statusName", price, "ticketCapacity", "createdAt")
SELECT id, 'early_bird', early_price, threshold, now() FROM demo_events
UNION ALL
SELECT id, 'greenlit', greenlit_price, max_capacity - threshold, now() FROM demo_events;

-- ── Allocations: bookings + items + tickets ──────────────────────────────────
DO $$
declare
  rec record;
  v_event_id uuid;
  v_user_id uuid;
  v_early record;
  v_greenlit record;
  v_booking_id bigint;
  v_item_id bigint;
  v_early_qty int;
  v_greenlit_qty int;
  v_total numeric;
  v_ticket_status text;
  i int;
begin
  for rec in select * from demo_allocations loop
    select id into v_event_id from demo_events where code = rec.code;
    select id into v_user_id from public."USER" where email = rec.user_email;
    select * into v_early from public."PRICE_STATUSES" where "eventId" = v_event_id and "statusName" = 'early_bird';
    select * into v_greenlit from public."PRICE_STATUSES" where "eventId" = v_event_id and "statusName" = 'greenlit';

    v_early_qty := least(rec.qty, v_early."ticketCapacity");
    v_greenlit_qty := greatest(0, rec.qty - v_early_qty);
    v_total := (v_early_qty * v_early.price) + (v_greenlit_qty * v_greenlit.price);

    insert into public."BOOKINGS"("userId", "eventId", "amountPaid", "refundedAmount", status, reference, "paymentMethod", "capturedAt", "createdAt", "updatedAt")
    values(v_user_id, v_event_id, v_total, 0, rec.booking_status, 'PF-DEMO-' || rec.code, rec.payment_method, now(), now(), now())
    returning id into v_booking_id;

    if v_early_qty > 0 then
      insert into public."BOOKING_ITEMS"("bookingId", "priceStatusId", quantity, "unitPrice", subtotal, "createdAt")
      values(v_booking_id, v_early.id, v_early_qty, v_early.price, v_early.price * v_early_qty, now())
      returning id into v_item_id;

      for i in 1..v_early_qty loop
        v_ticket_status := case when rec.used_count > 0 and i <= rec.used_count then 'used' else rec.ticket_status end;
        insert into public."TICKETS"("bookingId", "bookingItemId", "qrCode", status, "givenAwayAt", "usedAt", "createdAt")
        values(
          v_booking_id, v_item_id,
          'PF-DEMO-' || rec.code || '-' || lpad(i::text, 2, '0'),
          v_ticket_status,
          case when v_ticket_status = 'given_away' then now() else null end,
          case when v_ticket_status = 'used' then now() else null end,
          now()
        );
      end loop;
    end if;

    if v_greenlit_qty > 0 then
      insert into public."BOOKING_ITEMS"("bookingId", "priceStatusId", quantity, "unitPrice", subtotal, "createdAt")
      values(v_booking_id, v_greenlit.id, v_greenlit_qty, v_greenlit.price, v_greenlit.price * v_greenlit_qty, now())
      returning id into v_item_id;

      for i in 1..v_greenlit_qty loop
        v_ticket_status := rec.ticket_status;
        insert into public."TICKETS"("bookingId", "bookingItemId", "qrCode", status, "givenAwayAt", "usedAt", "createdAt")
        values(
          v_booking_id, v_item_id,
          'PF-DEMO-' || rec.code || '-G' || lpad(i::text, 2, '0'),
          v_ticket_status,
          case when v_ticket_status = 'given_away' then now() else null end,
          case when v_ticket_status = 'used' then now() else null end,
          now()
        );
      end loop;
    end if;
  end loop;
end $$;

-- ── Co-organiser invites (accepted / pending / declined examples) ─────────────
INSERT INTO public."EVENT_CO_ORGANISER_INVITES"("eventId", "ownerId", "inviteeId", status, "invitedAt", "respondedAt")
SELECT e.id, owner.id, invitee.id, 'accepted', now()-interval '2 days', now()-interval '1 day'
FROM demo_events e
JOIN public."USER" owner ON owner.email = 'organiser@smu.edu.sg'
JOIN public."USER" invitee ON invitee.email = 'partyfundemo@gmail.com'
WHERE e.code = 'SMU-01';

INSERT INTO public."EVENT_CO_ORGANISER_INVITES"("eventId", "ownerId", "inviteeId", status, "invitedAt", "respondedAt")
SELECT e.id, owner.id, invitee.id, 'pending', now()-interval '1 hour', null
FROM demo_events e
JOIN public."USER" owner ON owner.email = 'partyfundemo@gmail.com'
JOIN public."USER" invitee ON invitee.email = 'organiser@smu.edu.sg'
WHERE e.code = 'PFD-01';

INSERT INTO public."EVENT_CO_ORGANISER_INVITES"("eventId", "ownerId", "inviteeId", status, "invitedAt", "respondedAt")
SELECT e.id, owner.id, invitee.id, 'declined', now()-interval '3 days', now()-interval '2 days'
FROM demo_events e
JOIN public."USER" owner ON owner.email = 'partyfundemo@gmail.com'
JOIN public."USER" invitee ON invitee.email = 'organiser@smu.edu.sg'
WHERE e.code = 'PFD-08';

-- ── Demo guide (clean event names) ────────────────────────────────────────────
-- Create:  make a brand-new event live during the demo (no seed event needed).
-- Edit:    partyfundemo@gmail.com -> "Rooftop Mixer";   organiser@smu.edu.sg -> "Concourse Jam".
-- Delete:  partyfundemo@gmail.com -> "Empty Workshop";  organiser@smu.edu.sg -> "Empty CCA Briefing".
-- Co-organiser:
--   organiser@smu.edu.sg has a PENDING invite to co-host "Block Party" (partyfundemo's) — accept it.
--   partyfundemo@gmail.com is already an accepted co-organiser on "Study Break Social" (organiser@smu's).
-- Purchase:  user@smu.edu.sg buys "Arcade Night";   user2@smu.edu.sg buys "Picnic Beats".
-- Give away all (no refund):
--   user@smu.edu.sg gives away all tickets from "Silent Disco".
--   user2@smu.edu.sg gives away all tickets from "Makers Night".
-- Already-cancelled joined tab (gave everything away):
--   user@smu.edu.sg -> "Rooftop Snacks";   user2@smu.edu.sg -> "Wellness Social".
-- Check-in:  scan PF-DEMO-PFD-04-01 (success) or PF-DEMO-SMU-04-01 (already-used error).
-- Failed purchase:  user@smu.edu.sg tries "No More Spots" (full capacity).
-- Refund:  partyfundemo@gmail.com cancels "Poolside Reset" to show wallet refunds.
