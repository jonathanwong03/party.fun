-- Fix hype-driven pledges with a fresh idempotency key.
--
-- In PL/pgSQL, SELECT ... INTO clears target variables when no row is found.
-- The idempotency replay lookup selected amountPaid into v_total; when the key
-- was new, v_total became NULL. Tiered pricing reassigned v_total later, but
-- hype-driven pricing adds ticket prices one by one, so NULL + price stayed
-- NULL. Wallet pledges then failed with insufficient_funds because
-- walletBalance >= NULL matches no rows; card pledges could also persist a NULL
-- amount. Reset v_total before live pricing and guard against NULL totals.

CREATE OR REPLACE FUNCTION public._create_pledge_impl(
  p_user_id uuid, p_event_id uuid, p_qty integer, p_payment_method text,
  p_payment_intent_id text, p_charged_amount numeric, p_idempotency_key text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=p_user_id; v_event record; v_settings record; v_early record; v_greenlit record;
  v_active int; v_early_sold int; v_early_avail int; v_ec int; v_gc int;
  v_booking_id bigint; v_item_id bigint; v_total numeric:=0; v_now timestamptz:=now();
  v_reference text; v_bal numeric; v_qr_token uuid; v_greenlit_now boolean:=false;
  v_hype boolean; v_ticket_price numeric;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if p_qty is null or p_qty <= 0 then return json_build_object('error','bad_qty'); end if;
  -- NB: public.is_admin() reads auth.uid(), which is NULL when the backend calls this via
  -- service_role - check the PLEDGING user's role directly or the guard silently dies.
  if exists(select 1 from public."USER" where id=v_uid and role='admin') then
    return json_build_object('error','admin_no_purchase');
  end if;
  -- A 'card' pledge must carry proof the backend actually charged Stripe.
  if p_payment_method='card' and (p_payment_intent_id is null or p_charged_amount is null) then
    return json_build_object('error','payment_proof_required');
  end if;
  if p_payment_method not in ('wallet','card') then return json_build_object('error','bad_payment_method'); end if;

  if p_idempotency_key is not null then
    select id, reference, "amountPaid", "qrToken"
      into v_booking_id, v_reference, v_total, v_qr_token
      from public."BOOKINGS"
      where "idempotencyKey" = p_idempotency_key and "deletedAt" is null
      limit 1;
    if found then
      return json_build_object('status','ok','bookingId',v_booking_id::text,'reference',v_reference,
                               'amount',v_total,'qrToken',v_qr_token::text,'greenlitNow',false,'idempotent',true);
    end if;
  end if;

  v_total := 0;

  select * into v_event from public."EVENT" where id=p_event_id;
  if not found then return json_build_object('error','not_found'); end if;
  perform 1 from public."EVENT_SETTINGS" where "eventId"=p_event_id for update;
  if v_event.status='cancelled' then return json_build_object('error','event_cancelled'); end if;
  if v_event."hostId"=v_uid then return json_build_object('error','own_event'); end if;
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
    v_total := (case when v_ec > 0 then v_ec*v_early.price else 0 end)
             + (case when v_gc > 0 then v_gc*v_greenlit.price else 0 end);
    if v_total is null then return json_build_object('error','invalid_pricing'); end if;
  end if;

  if v_total is null then return json_build_object('error','invalid_pricing'); end if;

  if p_payment_method='card' and abs(v_total - p_charged_amount) > 0.015 then
    return json_build_object('error','price_mismatch');
  end if;

  if p_payment_method = 'wallet' then
    update public."USER" set "walletBalance" = "walletBalance" - v_total
      where id = v_uid and "walletBalance" >= v_total;
    if not found then return json_build_object('error','insufficient_funds'); end if;
  end if;
  v_reference:='PF-'||upper(substr(p_event_id::text,1,4))||'-'||lpad((floor(random()*9000)+1000)::int::text,4,'0');
  insert into public."BOOKINGS"("userId","eventId","amountPaid","refundedAmount",status,reference,"paymentMethod","stripePaymentIntentId","idempotencyKey","stripeChargeAt","capturedAt","createdAt","updatedAt")
  values(v_uid,p_event_id,0,0,'captured',v_reference,p_payment_method,p_payment_intent_id,p_idempotency_key,
         case when p_payment_method='card' then v_now else null end,v_now,v_now,v_now)
  returning id, "qrToken" into v_booking_id, v_qr_token;

  if v_hype then
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

REVOKE ALL ON FUNCTION public._create_pledge_impl(uuid, uuid, integer, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
