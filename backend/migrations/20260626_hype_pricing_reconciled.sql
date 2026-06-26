-- Hype-Driven Pricing — reconciled migration.
--
-- Supersedes the stale 20260618_hype_driven_pricing_pledge.sql and
-- 20260619_hype_get_events_giveaway.sql, which were authored before the June 22–25
-- work (co-organisers, org membership, university gating) and would have REGRESSED
-- create_pledge (university restriction) and get_events (permission flags / address /
-- viewer_can_attend) if applied verbatim.
--
-- This migration layers the bonding-curve pricing onto the CURRENT definitions:
--   1. additive EVENT_SETTINGS columns + hype_ticket_price() helper
--   2. create_pledge = current (June-25) body + p_charged_amount + curve branch + price_mismatch guard
--   3. get_events   = current (June-25) body + curve fields (hypeDrivenPricing/basePrice/maxPrice/current_dynamic_price)
-- give_away_tickets is unchanged: the live version already excludes given_away from active counts.
--
-- Bonding curve: P(x) = basePrice * (maxPrice / basePrice) ^ (x / maxCapacity)
-- The hypeDrivenPricing flag defaults false, so applying this is pricing-neutral for existing events.

-- ── 1. Additive schema ────────────────────────────────────────────────────────
ALTER TABLE public."EVENT_SETTINGS"
  ADD COLUMN IF NOT EXISTS "hypeDrivenPricing" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "basePrice" numeric,
  ADD COLUMN IF NOT EXISTS "maxPrice" numeric;

ALTER TABLE public."EVENT_SETTINGS" DROP CONSTRAINT IF EXISTS event_settings_hype_pricing_bounds;
ALTER TABLE public."EVENT_SETTINGS"
  ADD CONSTRAINT event_settings_hype_pricing_bounds
  CHECK (
    "hypeDrivenPricing" = false
    OR (
      "basePrice" IS NOT NULL
      AND "maxPrice" IS NOT NULL
      AND "basePrice" > 0
      AND "maxPrice" > 0
      AND "basePrice" < "maxPrice"
    )
  );

CREATE OR REPLACE FUNCTION public.hype_ticket_price(
  p_base numeric, p_max numeric, p_capacity int, p_active int
) RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_x int;
  v_ratio numeric;
begin
  if p_capacity is null or p_capacity <= 0 or p_base is null or p_max is null or p_base <= 0 or p_max <= 0 or p_base >= p_max then
    return null;
  end if;
  v_x := greatest(0, least(p_active, p_capacity));
  v_ratio := p_max / p_base;
  return round((p_base * power(v_ratio, v_x::numeric / p_capacity))::numeric, 2);
end;
$function$;

-- ── 2. create_pledge: current body + hype branch + price_mismatch guard ────────
DROP FUNCTION IF EXISTS public.create_pledge(uuid, integer, text, text);
CREATE OR REPLACE FUNCTION public.create_pledge(
  p_event_id uuid,
  p_qty integer,
  p_payment_method text DEFAULT 'wallet'::text,
  p_payment_intent_id text DEFAULT NULL::text,
  p_charged_amount numeric DEFAULT NULL
)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=auth.uid(); v_event record; v_settings record; v_early record; v_greenlit record;
  v_active int; v_early_sold int; v_early_avail int; v_ec int; v_gc int;
  v_booking_id bigint; v_item_id bigint; v_total numeric:=0; v_now timestamptz:=now();
  v_reference text; v_bal numeric; v_qr_token uuid; v_greenlit_now boolean:=false;
  v_hype boolean; v_ticket_price numeric;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if public.is_admin() then return json_build_object('error','admin_no_purchase'); end if;
  select * into v_event from public."EVENT" where id=p_event_id;
  if not found then return json_build_object('error','not_found'); end if;
  if v_event.status='cancelled' then return json_build_object('error','event_cancelled'); end if;
  if v_event."hostId"=v_uid then return json_build_object('error','own_event'); end if;
  -- University‑restricted events: the buyer's recorded university must match.
  if v_event."restrictedUniversity" is not null
     and (select university from public."USER" where id=v_uid) is distinct from v_event."restrictedUniversity" then
    return json_build_object('error','university_restricted');
  end if;
  if exists(select 1 from public."BOOKINGS" b join public."TICKETS" t on t."bookingId"=b.id
      where b."userId"=v_uid and b."eventId"=p_event_id and b."deletedAt" is null and t.status in('active','used'))
  then return json_build_object('error','active_booking_exists'); end if;
  select * into v_settings from public."EVENT_SETTINGS" where "eventId"=p_event_id;
  select * into v_early    from public."PRICE_STATUSES" where "eventId"=p_event_id and "statusName"='early_bird';
  select * into v_greenlit from public."PRICE_STATUSES" where "eventId"=p_event_id and "statusName"='greenlit';
  select count(*)::int into v_active from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
    where b."eventId"=p_event_id and t.status in('active','used') and b."deletedAt" is null;
  if v_active+p_qty > v_settings."maxCapacity" then return json_build_object('error','not_enough_tickets'); end if;

  v_hype := coalesce(v_settings."hypeDrivenPricing", false);

  -- Compute the charged total: bonding curve (one price per ticket) when hype-driven,
  -- otherwise the static early-bird/greenlit tier split.
  if v_hype then
    if v_settings."basePrice" is null or v_settings."maxPrice" is null
       or v_settings."basePrice" <= 0 or v_settings."maxPrice" <= 0
       or v_settings."basePrice" >= v_settings."maxPrice" then
      return json_build_object('error','invalid_hype_pricing');
    end if;
    for k in 0..(p_qty-1) loop
      v_ticket_price := public.hype_ticket_price(v_settings."basePrice", v_settings."maxPrice", v_settings."maxCapacity", v_active+k);
      if v_ticket_price is null then return json_build_object('error','invalid_hype_pricing'); end if;
      v_total := v_total + v_ticket_price;
    end loop;
  else
    select count(*)::int into v_early_sold from public."TICKETS" t
      join public."BOOKING_ITEMS" bi on bi.id=t."bookingItemId" join public."BOOKINGS" b on b.id=t."bookingId"
      where bi."priceStatusId"=v_early.id and t.status in('active','used') and b."deletedAt" is null;
    v_early_avail:=greatest(0,v_early."ticketCapacity"-v_early_sold);
    v_ec:=least(v_early_avail,p_qty); v_gc:=p_qty-v_ec;
    v_total := v_ec*v_early.price + v_gc*v_greenlit.price;
  end if;

  -- Price guard: reject a card pledge whose quoted total drifted from the live total
  -- (the curve moves as tickets sell). Wallet pledges pass p_charged_amount = null.
  if p_payment_method='card' and p_charged_amount is not null
     and abs(v_total - p_charged_amount) > 0.015 then
    return json_build_object('error','price_mismatch');
  end if;

  if p_payment_method = 'wallet' then
    update public."USER" set "walletBalance" = "walletBalance" - v_total
      where id = v_uid and "walletBalance" >= v_total;
    if not found then return json_build_object('error','insufficient_funds'); end if;
  end if;
  v_reference:='PF-'||upper(substr(p_event_id::text,1,4))||'-'||lpad((floor(random()*9000)+1000)::int::text,4,'0');
  insert into public."BOOKINGS"("userId","eventId","amountPaid","refundedAmount",status,reference,"paymentMethod","stripePaymentIntentId","capturedAt","createdAt","updatedAt")
  values(v_uid,p_event_id,0,0,'captured',v_reference,p_payment_method,p_payment_intent_id,v_now,v_now,v_now)
  returning id, "qrToken" into v_booking_id, v_qr_token;

  if v_hype then
    -- One BOOKING_ITEM per ticket at its own curve price (early-bird row is the placeholder status).
    for k in 0..(p_qty-1) loop
      v_ticket_price := public.hype_ticket_price(v_settings."basePrice", v_settings."maxPrice", v_settings."maxCapacity", v_active+k);
      insert into public."BOOKING_ITEMS"("bookingId","priceStatusId",quantity,"unitPrice",subtotal,"createdAt")
      values(v_booking_id,v_early.id,1,v_ticket_price,v_ticket_price,v_now) returning id into v_item_id;
      insert into public."TICKETS"("bookingId","bookingItemId","qrCode",status,"createdAt")
      values(v_booking_id,v_item_id,'PF-'||gen_random_uuid()::text,'active',v_now);
    end loop;
  else
    if v_ec>0 then
      insert into public."BOOKING_ITEMS"("bookingId","priceStatusId",quantity,"unitPrice",subtotal,"createdAt")
      values(v_booking_id,v_early.id,v_ec,v_early.price,v_early.price*v_ec,v_now) returning id into v_item_id;
      for i in 1..v_ec loop
        insert into public."TICKETS"("bookingId","bookingItemId","qrCode",status,"createdAt")
        values(v_booking_id,v_item_id,'PF-'||gen_random_uuid()::text,'active',v_now);
      end loop;
    end if;
    if v_gc>0 then
      insert into public."BOOKING_ITEMS"("bookingId","priceStatusId",quantity,"unitPrice",subtotal,"createdAt")
      values(v_booking_id,v_greenlit.id,v_gc,v_greenlit.price,v_greenlit.price*v_gc,v_now) returning id into v_item_id;
      for i in 1..v_gc loop
        insert into public."TICKETS"("bookingId","bookingItemId","qrCode",status,"createdAt")
        values(v_booking_id,v_item_id,'PF-'||gen_random_uuid()::text,'active',v_now);
      end loop;
    end if;
  end if;

  update public."BOOKINGS" set "amountPaid"=v_total,"updatedAt"=v_now where id=v_booking_id;
  if p_payment_method = 'wallet' then
    select "walletBalance" into v_bal from public."USER" where id=v_uid;
    insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
      values(v_uid,'pledge','wallet',v_total,v_bal,p_event_id);
  end if;
  if v_event.status='early_bird' and (v_active+p_qty) >= v_settings."hypeThreshold" then
    update public."EVENT" set status='greenlit',"updatedAt"=v_now where id=p_event_id and status='early_bird';
    if found then v_greenlit_now := true; end if;
  end if;
  return json_build_object('status','ok','bookingId',v_booking_id::text,'reference',v_reference,'amount',v_total,
                           'qrToken',v_qr_token::text,'greenlitNow',v_greenlit_now);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text, numeric) TO authenticated;

-- ── 3. get_events: current body + curve fields ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_events()
 RETURNS SETOF json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id', e.id, 'hostId', e."hostId", 'title', coalesce(e.title, ''),
    'description', coalesce(e.description, ''), 'location', coalesce(e.location, ''),
    'address', coalesce(e.address, ''),
    'imageUrl', coalesce(e."imageUrl", ''), 'startDate', e."startDate", 'endDate', e."endDate",
    'deadlineAt', es.deadline, 'hypeThreshold', es."hypeThreshold", 'maxCapacity', es."maxCapacity",
    'hypeDrivenPricing', coalesce(es."hypeDrivenPricing", false),
    'basePrice', es."basePrice",
    'maxPrice', es."maxPrice",
    'current_dynamic_price', CASE
      WHEN coalesce(es."hypeDrivenPricing", false) THEN
        public.hype_ticket_price(es."basePrice", es."maxPrice", es."maxCapacity",
          (SELECT count(*)::int FROM public."TICKETS" t JOIN public."BOOKINGS" b ON b.id = t."bookingId"
            WHERE b."eventId" = e.id AND t.status IN ('active','used') AND b."deletedAt" IS NULL))
      ELSE NULL END,
    'organiser_name', coalesce(u.name, u.username, ''), 'host_university', coalesce(u.university, ''),
    'restricted_university', coalesce(e."restrictedUniversity", ''),
    -- True when the event is open, the viewer is a guest, or the signed-in viewer's
    -- recorded university matches. A logged-in non-member is false.
    'viewer_can_attend', (
      e."restrictedUniversity" IS NULL
      OR (SELECT auth.uid()) IS NULL
      OR e."restrictedUniversity" = coalesce((SELECT university FROM public."USER" WHERE id = (SELECT auth.uid())), '')
    ),
    'hostHidden', e."hostHidden",
    'isCoOrganiser', public.is_event_coorganiser(e.id, (select auth.uid())),
    'canEdit', public.can_manage_event(e.id, (select auth.uid())),
    'canCheckIn', public.can_manage_event(e.id, (select auth.uid())),
    'canViewAttendees', public.can_manage_event(e.id, (select auth.uid())),
    'canCancel', public.is_event_owner(e.id, (select auth.uid())) OR public.is_admin(),
    'canDelete', public.is_event_owner(e.id, (select auth.uid())) OR public.is_admin(),
    'derived_status', CASE
      WHEN e.status = 'cancelled' THEN 'cancelled'
      WHEN e.status = 'completed' THEN 'completed'
      WHEN e.status = 'greenlit' THEN 'greenlit'
      WHEN e."endDate" < now() THEN 'completed'
      WHEN (SELECT count(*) FROM public."TICKETS" t JOIN public."BOOKINGS" b ON b.id = t."bookingId"
            WHERE b."eventId" = e.id AND t.status IN ('active','used') AND b."deletedAt" IS NULL) >= es."hypeThreshold" THEN 'greenlit'
      ELSE 'early_bird' END,
    'active_ticket_count', (SELECT count(*)::int FROM public."TICKETS" t JOIN public."BOOKINGS" b ON b.id = t."bookingId"
      WHERE b."eventId" = e.id AND t.status IN ('active','used') AND b."deletedAt" IS NULL),
    'statuses', (SELECT json_agg(json_build_object(
        'statusName', ps."statusName", 'price', ps.price, 'ticketCapacity', ps."ticketCapacity",
        'sold', (SELECT count(*)::int FROM public."TICKETS" t2 JOIN public."BOOKING_ITEMS" bi ON bi.id = t2."bookingItemId"
                 JOIN public."BOOKINGS" b2 ON b2.id = t2."bookingId"
                 WHERE bi."priceStatusId" = ps.id AND t2.status IN ('active','used') AND b2."deletedAt" IS NULL)
      ) ORDER BY ps."statusName" ASC) FROM public."PRICE_STATUSES" ps WHERE ps."eventId" = e.id)
  )
  FROM public."EVENT" e
  JOIN public."USER" u ON u.id = e."hostId"
  JOIN public."EVENT_SETTINGS" es ON es."eventId" = e.id
  ORDER BY e."createdAt" DESC;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_events() TO anon, authenticated;
