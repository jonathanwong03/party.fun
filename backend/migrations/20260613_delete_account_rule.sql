-- Migration: allow account deletion unless the organiser hosts an ACTIVE
-- (early_bird/greenlit) event. Leftover cancelled/completed events + their
-- dependent rows + drafts are removed so the auth.users cascade can proceed.
CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  declare uid uuid := auth.uid();
  begin
    if uid is null then
      raise exception 'not_authenticated' using errcode = '42501';
    end if;
    if exists (select 1 from public."EVENT" where "hostId" = uid and status in ('early_bird','greenlit')) then
      raise exception 'has_active_events' using errcode = 'P0001';
    end if;

    -- Remove the caller's leftover hosted events (cancelled/completed) + dependents.
    delete from public."TICKETS" t
      using public."BOOKINGS" b, public."EVENT" e
      where t."bookingId" = b.id and b."eventId" = e.id and e."hostId" = uid;
    delete from public."BOOKING_ITEMS" bi
      using public."BOOKINGS" b, public."EVENT" e
      where bi."bookingId" = b.id and b."eventId" = e.id and e."hostId" = uid;
    delete from public."BOOKINGS" b
      using public."EVENT" e
      where b."eventId" = e.id and e."hostId" = uid;
    delete from public."PRICE_STATUSES" ps
      using public."EVENT" e
      where ps."eventId" = e.id and e."hostId" = uid;
    delete from public."EVENT_SETTINGS" es
      using public."EVENT" e
      where es."eventId" = e.id and e."hostId" = uid;
    delete from public."EVENT" where "hostId" = uid;

    -- Remove the caller's own bookings (as a backer) + their tickets/items.
    delete from public."TICKETS" t using public."BOOKINGS" b
      where t."bookingId" = b.id and b."userId" = uid;
    delete from public."BOOKING_ITEMS" bi using public."BOOKINGS" b
      where bi."bookingId" = b.id and b."userId" = uid;
    delete from public."BOOKINGS" where "userId" = uid;

    -- Drafts reference USER (NO ACTION) — clear before the auth cascade.
    delete from public."EVENT_DRAFTS" where "userId" = uid;

    -- auth.users delete cascades to public."USER".
    delete from auth.users where id = uid;
  end; $function$;
