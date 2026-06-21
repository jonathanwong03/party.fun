-- Hype-Driven Pricing: EVENT_SETTINGS columns + bonding-curve create_pledge.
-- When hypeDrivenPricing is true, ticket prices follow:
--   P(x) = basePrice * (maxPrice / basePrice) ^ (x / maxCapacity)
-- and each ticket in a pledge gets its own BOOKING_ITEM at the curve price.

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

DROP FUNCTION IF EXISTS public.create_pledge(uuid, integer, text, text);
CREATE OR REPLACE FUNCTION public.create_pledge(
  p_event_id uuid,
  p_qty integer,
  p_payment_method text DEFAULT 'wallet',
  p_payment_intent_id text DEFAULT NULL,
  p_charged_amount numeric DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_event record;
  v_settings record;
  v_early record;
  v_greenlit record;
  v_active int;
  v_early_sold int;
  v_early_avail int;
  v_ec int;
  v_gc int;
  v_booking_id bigint;
  v_item_id bigint;
  v_total numeric := 0;
  v_ticket_price numeric;
  v_now timestamptz := now();
  v_reference text;
  v_bal numeric;
  k int;
begin
  if v_uid is null then return json_build_object('error', 'not_authenticated'); end if;
  select * into v_event from public."EVENT" where id = p_event_id;
  if not found then return json_build_object('error', 'not_found'); end if;
  if v_event.status = 'cancelled' then return json_build_object('error', 'event_cancelled'); end if;
  if v_event."hostId" = v_uid then return json_build_object('error', 'own_event'); end if;
  if exists(
    select 1 from public."BOOKINGS" b
    join public."TICKETS" t on t."bookingId" = b.id
    where b."userId" = v_uid and b."eventId" = p_event_id and b."deletedAt" is null and t.status in ('active', 'used')
  ) then return json_build_object('error', 'active_booking_exists'); end if;

  select * into v_settings from public."EVENT_SETTINGS" where "eventId" = p_event_id;
  select * into v_early from public."PRICE_STATUSES" where "eventId" = p_event_id and "statusName" = 'early_bird';
  select * into v_greenlit from public."PRICE_STATUSES" where "eventId" = p_event_id and "statusName" = 'greenlit';

  select count(*)::int into v_active
  from public."TICKETS" t
  join public."BOOKINGS" b on b.id = t."bookingId"
  where b."eventId" = p_event_id and t.status in ('active', 'used') and b."deletedAt" is null;

  if v_active + p_qty > v_settings."maxCapacity" then
    return json_build_object('error', 'not_enough_tickets');
  end if;

  if coalesce(v_settings."hypeDrivenPricing", false) then
    if v_settings."basePrice" is null or v_settings."maxPrice" is null
       or v_settings."basePrice" <= 0 or v_settings."maxPrice" <= 0
       or v_settings."basePrice" >= v_settings."maxPrice" then
      return json_build_object('error', 'invalid_hype_pricing');
    end if;
    for k in 0..(p_qty - 1) loop
      v_ticket_price := public.hype_ticket_price(
        v_settings."basePrice", v_settings."maxPrice", v_settings."maxCapacity", v_active + k);
      if v_ticket_price is null then
        return json_build_object('error', 'invalid_hype_pricing');
      end if;
      v_total := v_total + v_ticket_price;
    end loop;
  else
    select count(*)::int into v_early_sold
    from public."TICKETS" t
    join public."BOOKING_ITEMS" bi on bi.id = t."bookingItemId"
    join public."BOOKINGS" b on b.id = t."bookingId"
    where bi."priceStatusId" = v_early.id and t.status in ('active', 'used') and b."deletedAt" is null;
    v_early_avail := greatest(0, v_early."ticketCapacity" - v_early_sold);
    v_ec := least(v_early_avail, p_qty);
    v_gc := p_qty - v_ec;
    v_total := v_ec * v_early.price + v_gc * v_greenlit.price;
  end if;

  if p_payment_method = 'card' and p_charged_amount is not null and abs(v_total - p_charged_amount) > 0.015 then
    return json_build_object('error', 'price_mismatch');
  end if;

  if p_payment_method = 'wallet' then
    update public."USER" set "walletBalance" = "walletBalance" - v_total
      where id = v_uid and "walletBalance" >= v_total;
    if not found then return json_build_object('error', 'insufficient_funds'); end if;
  end if;

  v_reference := 'PF-' || upper(substr(p_event_id::text, 1, 4)) || '-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
  insert into public."BOOKINGS"(
    "userId", "eventId", "amountPaid", "refundedAmount", status, reference,
    "paymentMethod", "stripePaymentIntentId", "capturedAt", "createdAt", "updatedAt"
  ) values (
    v_uid, p_event_id, 0, 0, 'captured', v_reference,
    p_payment_method, p_payment_intent_id, v_now, v_now, v_now
  ) returning id into v_booking_id;

  if coalesce(v_settings."hypeDrivenPricing", false) then
    for k in 0..(p_qty - 1) loop
      v_ticket_price := public.hype_ticket_price(
        v_settings."basePrice", v_settings."maxPrice", v_settings."maxCapacity", v_active + k);
      insert into public."BOOKING_ITEMS"("bookingId", "priceStatusId", quantity, "unitPrice", subtotal, "createdAt")
      values (v_booking_id, v_early.id, 1, v_ticket_price, v_ticket_price, v_now)
      returning id into v_item_id;
      insert into public."TICKETS"("bookingId", "bookingItemId", "qrCode", status, "createdAt")
      values (v_booking_id, v_item_id, 'PF-' || gen_random_uuid()::text, 'active', v_now);
    end loop;
  else
    if v_ec > 0 then
      insert into public."BOOKING_ITEMS"("bookingId", "priceStatusId", quantity, "unitPrice", subtotal, "createdAt")
      values (v_booking_id, v_early.id, v_ec, v_early.price, v_early.price * v_ec, v_now)
      returning id into v_item_id;
      for k in 1..v_ec loop
        insert into public."TICKETS"("bookingId", "bookingItemId", "qrCode", status, "createdAt")
        values (v_booking_id, v_item_id, 'PF-' || gen_random_uuid()::text, 'active', v_now);
      end loop;
    end if;
    if v_gc > 0 then
      insert into public."BOOKING_ITEMS"("bookingId", "priceStatusId", quantity, "unitPrice", subtotal, "createdAt")
      values (v_booking_id, v_greenlit.id, v_gc, v_greenlit.price, v_greenlit.price * v_gc, v_now)
      returning id into v_item_id;
      for k in 1..v_gc loop
        insert into public."TICKETS"("bookingId", "bookingItemId", "qrCode", status, "createdAt")
        values (v_booking_id, v_item_id, 'PF-' || gen_random_uuid()::text, 'active', v_now);
      end loop;
    end if;
  end if;

  update public."BOOKINGS" set "amountPaid" = v_total, "updatedAt" = v_now where id = v_booking_id;

  if p_payment_method = 'wallet' then
    select "walletBalance" into v_bal from public."USER" where id = v_uid;
    insert into public."WALLET_TRANSACTIONS"("userId", type, source, amount, "balanceAfter", "eventId")
    values (v_uid, 'pledge', 'wallet', v_total, v_bal, p_event_id);
  end if;

  if v_event.status = 'early_bird' and (v_active + p_qty) >= v_settings."hypeThreshold" then
    update public."EVENT" set status = 'greenlit', "updatedAt" = v_now where id = p_event_id and status = 'early_bird';
  end if;

  return json_build_object('status', 'ok', 'bookingId', v_booking_id::text, 'reference', v_reference, 'amount', v_total);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text, numeric) TO authenticated;
