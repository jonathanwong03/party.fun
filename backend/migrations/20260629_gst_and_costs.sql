-- 9% GST on purchases (buyer-paid, revenue-excluded) + organiser operational costs and a
-- simulated profit payout at event end.
--   * BOOKINGS.gstAmount records GST collected; amountPaid stays GST-free (organiser revenue).
--   * EVENT_SETTINGS gains 7 cost columns; create_event/update_event accept a p_costs jsonb.
--   * EVENT.costTotal/profit store the settled figures; complete_due_events pays profit
--     (revenue - costs*1.1 contingency) to the organiser as a simulated bank transfer.

-- ── Schema ──────────────────────────────────────────────────────────────────
ALTER TABLE public."BOOKINGS" ADD COLUMN IF NOT EXISTS "gstAmount" numeric NOT NULL DEFAULT 0;
ALTER TABLE public."EVENT_SETTINGS"
  ADD COLUMN IF NOT EXISTS "costVenue" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "costFnb" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "costAv" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "costTalent" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "costMarketing" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "costStaffing" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "costDecor" numeric NOT NULL DEFAULT 0;
ALTER TABLE public."EVENT"
  ADD COLUMN IF NOT EXISTS "costTotal" numeric,
  ADD COLUMN IF NOT EXISTS "profit" numeric;

-- ── create_pledge: add 9% GST (buyer pays total*1.09; amountPaid stays GST-free) ──
DROP FUNCTION IF EXISTS public.create_pledge(uuid, integer, text, text, numeric);
CREATE OR REPLACE FUNCTION public.create_pledge(
  p_event_id uuid, p_qty integer, p_payment_method text DEFAULT 'wallet'::text,
  p_payment_intent_id text DEFAULT NULL::text, p_charged_amount numeric DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=auth.uid(); v_event record; v_settings record; v_early record; v_greenlit record;
  v_active int; v_early_sold int; v_early_avail int; v_ec int; v_gc int;
  v_booking_id bigint; v_item_id bigint; v_total numeric:=0; v_now timestamptz:=now();
  v_reference text; v_bal numeric; v_qr_token uuid; v_greenlit_now boolean:=false;
  v_hype boolean; v_ticket_price numeric; v_gst numeric;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if public.is_admin() then return json_build_object('error','admin_no_purchase'); end if;

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

  select * into v_event from public."EVENT" where id=p_event_id;
  if not found then return json_build_object('error','not_found'); end if;
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
    v_total := v_ec*v_early.price + v_gc*v_greenlit.price;
  end if;

  -- price_mismatch guard compares the GST-free ticket total (the client sends total excl GST).
  if p_payment_method='card' and p_charged_amount is not null
     and abs(v_total - p_charged_amount) > 0.015 then
    return json_build_object('error','price_mismatch');
  end if;

  v_gst := round(v_total * 0.09, 2);  -- 9% GST, paid by the buyer, excluded from revenue

  -- Wallet pays the grand total (tickets + GST); balance is checked against it.
  if p_payment_method = 'wallet' then
    update public."USER" set "walletBalance" = "walletBalance" - (v_total + v_gst)
      where id = v_uid and "walletBalance" >= (v_total + v_gst);
    if not found then return json_build_object('error','insufficient_funds'); end if;
  end if;
  v_reference:='PF-'||upper(substr(p_event_id::text,1,4))||'-'||lpad((floor(random()*9000)+1000)::int::text,4,'0');
  insert into public."BOOKINGS"("userId","eventId","amountPaid","gstAmount","refundedAmount",status,reference,"paymentMethod","stripePaymentIntentId","idempotencyKey","stripeChargeAt","capturedAt","createdAt","updatedAt")
  values(v_uid,p_event_id,0,v_gst,0,'captured',v_reference,p_payment_method,p_payment_intent_id,p_idempotency_key,
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
      values(v_uid,'pledge','wallet',v_total + v_gst,v_bal,p_event_id);
  end if;
  if v_event.status='early_bird' and (v_active+p_qty) >= v_settings."hypeThreshold" then
    update public."EVENT" set status='greenlit',"updatedAt"=v_now where id=p_event_id and status='early_bird';
    if found then v_greenlit_now := true; end if;
  end if;
  return json_build_object('status','ok','bookingId',v_booking_id::text,'reference',v_reference,'amount',v_total,
                           'gst',v_gst,'qrToken',v_qr_token::text,'greenlitNow',v_greenlit_now);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text, numeric, text) TO authenticated;

-- ── create_event / update_event: accept a p_costs jsonb and persist 7 cost categories ──
DROP FUNCTION IF EXISTS public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric);
CREATE OR REPLACE FUNCTION public.create_event(
  p_title text, p_description text, p_location text, p_start_date timestamptz, p_end_date timestamptz,
  p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamptz,
  p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer,
  p_address text DEFAULT '', p_restrict_university boolean DEFAULT false,
  p_hype_driven boolean DEFAULT false, p_base_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_costs jsonb DEFAULT '{}'::jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_event_id uuid; v_user record; v_max int; v_threshold int; v_hype boolean;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_user from public."USER" where id=v_uid;
  if v_user.role!='organiser' then return json_build_object('error','not_organiser'); end if;
  v_hype := coalesce(p_hype_driven, false);
  if v_hype then
    if p_base_price is null or p_max_price is null or p_base_price <= 0 or p_max_price <= 0 or p_base_price >= p_max_price then
      return json_build_object('error','hype_pricing_invalid');
    end if;
  else
    if p_greenlit_price <= p_early_price then return json_build_object('error','price_order'); end if;
  end if;
  if p_end_date <= p_start_date then return json_build_object('error','bad_schedule'); end if;
  if p_deadline >= p_start_date then return json_build_object('error','deadline_after_start'); end if;
  if p_start_date <= now() or p_deadline <= now() then return json_build_object('error','not_future'); end if;
  v_threshold := p_early_capacity; v_max := p_early_capacity + p_greenlit_capacity;
  insert into public."EVENT"("hostId",title,description,location,address,"restrictedUniversity","startDate","endDate","imageUrl",status,"createdAt","updatedAt")
  values(v_uid,p_title,p_description,p_location,nullif(btrim(coalesce(p_address,'')),''),
         case when p_restrict_university then v_user.university else null end,
         p_start_date,p_end_date,p_image_url,'early_bird',now(),now())
  returning id into v_event_id;
  insert into public."EVENT_SETTINGS"("eventId","hypeThreshold","maxCapacity",deadline,"hypeDrivenPricing","basePrice","maxPrice",
         "costVenue","costFnb","costAv","costTalent","costMarketing","costStaffing","costDecor","createdAt","updatedAt")
  values(v_event_id,v_threshold,v_max,p_deadline,
         v_hype,
         case when v_hype then p_base_price else null end,
         case when v_hype then p_max_price else null end,
         coalesce((p_costs->>'venue')::numeric,0), coalesce((p_costs->>'fnb')::numeric,0),
         coalesce((p_costs->>'av')::numeric,0), coalesce((p_costs->>'talent')::numeric,0),
         coalesce((p_costs->>'marketing')::numeric,0), coalesce((p_costs->>'staffing')::numeric,0),
         coalesce((p_costs->>'decor')::numeric,0), now(),now());
  insert into public."PRICE_STATUSES"("eventId","statusName",price,"ticketCapacity","createdAt") values
    (v_event_id,'early_bird', case when v_hype then p_base_price else p_early_price end, p_early_capacity, now()),
    (v_event_id,'greenlit',   case when v_hype then p_max_price  else p_greenlit_price end, p_greenlit_capacity, now());
  return json_build_object('status','ok','eventId',v_event_id::text);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric);
CREATE OR REPLACE FUNCTION public.update_event(
  p_event_id uuid, p_title text, p_description text, p_location text, p_start_date timestamptz, p_end_date timestamptz,
  p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamptz,
  p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer,
  p_address text DEFAULT '', p_restrict_university boolean DEFAULT false,
  p_hype_driven boolean DEFAULT false, p_base_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_costs jsonb DEFAULT '{}'::jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_event record; v_settings record; v_max int; v_threshold int; v_host_univ text; v_new_hype boolean;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_event from public."EVENT" where id = p_event_id and public.can_manage_event(id, v_uid);
  if not found then return json_build_object('error','not_found'); end if;
  select * into v_settings from public."EVENT_SETTINGS" where "eventId" = p_event_id;

  if v_event.status <> 'early_bird'
     and coalesce(p_hype_driven, false) is distinct from coalesce(v_settings."hypeDrivenPricing", false) then
    return json_build_object('error','pricing_locked');
  end if;
  v_new_hype := case when v_event.status = 'early_bird'
                     then coalesce(p_hype_driven, false)
                     else coalesce(v_settings."hypeDrivenPricing", false) end;

  if v_new_hype then
    if p_base_price is null or p_max_price is null or p_base_price <= 0 or p_max_price <= 0 or p_base_price >= p_max_price then
      return json_build_object('error','hype_pricing_invalid');
    end if;
  else
    if p_greenlit_price <= p_early_price then return json_build_object('error','price_order'); end if;
  end if;
  if p_end_date <= p_start_date then return json_build_object('error','bad_schedule'); end if;
  if v_event.status = 'early_bird' then
    if p_deadline >= p_start_date then return json_build_object('error','deadline_after_start'); end if;
    if p_start_date <= now() or p_deadline <= now() then return json_build_object('error','not_future'); end if;
  end if;
  select university into v_host_univ from public."USER" where id = v_event."hostId";
  v_threshold := p_early_capacity; v_max := p_early_capacity + p_greenlit_capacity;
  update public."EVENT" set title=p_title, description=p_description, location=p_location,
    address=nullif(btrim(coalesce(p_address,'')),''),
    "restrictedUniversity"=case when p_restrict_university then v_host_univ else null end,
    "startDate"=p_start_date, "endDate"=p_end_date, "imageUrl"=p_image_url, "updatedAt"=now()
    where id = p_event_id;
  update public."EVENT_SETTINGS" set "hypeThreshold"=v_threshold, "maxCapacity"=v_max, deadline=p_deadline,
    "hypeDrivenPricing"=v_new_hype,
    "basePrice"=case when v_new_hype then p_base_price else null end,
    "maxPrice"=case when v_new_hype then p_max_price else null end,
    "costVenue"=coalesce((p_costs->>'venue')::numeric,"costVenue"),
    "costFnb"=coalesce((p_costs->>'fnb')::numeric,"costFnb"),
    "costAv"=coalesce((p_costs->>'av')::numeric,"costAv"),
    "costTalent"=coalesce((p_costs->>'talent')::numeric,"costTalent"),
    "costMarketing"=coalesce((p_costs->>'marketing')::numeric,"costMarketing"),
    "costStaffing"=coalesce((p_costs->>'staffing')::numeric,"costStaffing"),
    "costDecor"=coalesce((p_costs->>'decor')::numeric,"costDecor"),
    "updatedAt"=now()
    where "eventId" = p_event_id;
  update public."PRICE_STATUSES" set price=case when v_new_hype then p_base_price else p_early_price end, "ticketCapacity"=p_early_capacity
    where "eventId"=p_event_id and "statusName"='early_bird';
  update public."PRICE_STATUSES" set price=case when v_new_hype then p_max_price else p_greenlit_price end, "ticketCapacity"=p_greenlit_capacity
    where "eventId"=p_event_id and "statusName"='greenlit';
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb) TO authenticated;

-- ── complete_due_events: pay PROFIT (revenue - costs*1.1) to the organiser (simulated bank) ──
CREATE OR REPLACE FUNCTION public.complete_due_events()
 RETURNS TABLE(event_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_now timestamptz := now(); rec record; v_net numeric; v_cost numeric; v_profit numeric; v_bal numeric;
begin
  for rec in select e.id, e."hostId" from public."EVENT" e
             where e.status='greenlit' and e."endDate" < v_now and e."disbursedAt" is null loop
    select coalesce(sum(b."amountPaid" - b."refundedAmount"),0) into v_net
      from public."BOOKINGS" b where b."eventId"=rec.id and b."deletedAt" is null;
    select coalesce(("costVenue"+"costFnb"+"costAv"+"costTalent"+"costMarketing"+"costStaffing"+"costDecor") * 1.10, 0)
      into v_cost from public."EVENT_SETTINGS" where "eventId"=rec.id;
    v_profit := v_net - v_cost;
    -- Simulated bank payout of the profit (does NOT touch the in-app wallet balance).
    if v_profit > 0 then
      select "walletBalance" into v_bal from public."USER" where id=rec."hostId";
      insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
        values(rec."hostId",'payout','bank',v_profit,coalesce(v_bal,0),rec.id);
    end if;
    update public."EVENT" set status='completed', "costTotal"=v_cost, "profit"=v_profit,
      "disbursedAt"=v_now, "updatedAt"=v_now where id=rec.id;
    event_id := rec.id; return next;
  end loop;
end; $function$;
REVOKE EXECUTE ON FUNCTION public.complete_due_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_due_events() TO service_role;

-- ── get_events: expose the per-event cost estimates (for edit prefill + forecasting) ──
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
    'costs', json_build_object('venue',es."costVenue",'fnb',es."costFnb",'av',es."costAv",'talent',es."costTalent",'marketing',es."costMarketing",'staffing',es."costStaffing",'decor',es."costDecor"),
    'current_dynamic_price', CASE
      WHEN coalesce(es."hypeDrivenPricing", false) THEN
        public.hype_ticket_price(es."basePrice", es."maxPrice", es."maxCapacity",
          (SELECT count(*)::int FROM public."TICKETS" t JOIN public."BOOKINGS" b ON b.id = t."bookingId"
            WHERE b."eventId" = e.id AND t.status IN ('active','used') AND b."deletedAt" IS NULL))
      ELSE NULL END,
    'organiser_name', coalesce(u.name, u.username, ''), 'host_university', coalesce(u.university, ''),
    'restricted_university', coalesce(e."restrictedUniversity", ''),
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
