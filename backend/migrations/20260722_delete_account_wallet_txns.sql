-- Migration: fix account deletion blocked by WALLET_TRANSACTIONS.
-- The wallet ledger (added in 20260617_stripe_wallet.sql) references USER(id) with NO ACTION,
-- but delete_my_account() (20260613) predates it and never cleared those rows, so the auth.users
-- cascade to public."USER" was blocked by "WALLET_TRANSACTIONS_userId_fkey" for any user who had
-- ever topped up, pledged by wallet, or been refunded. Clear the caller's own ledger rows before
-- the cascade, mirroring how the caller's EVENT_DRAFTS are cleared. Body is otherwise unchanged.
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

    -- WALLET_TRANSACTIONS references USER (NO ACTION) — clear the caller's ledger before the auth cascade.
    delete from public."WALLET_TRANSACTIONS" where "userId" = uid;

    -- auth.users delete cascades to public."USER".
    delete from auth.users where id = uid;
  end; $function$;
