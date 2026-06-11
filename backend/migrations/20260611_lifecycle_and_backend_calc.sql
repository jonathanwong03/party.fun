-- Migration: lifecycle columns + backend-authoritative calculations
-- Apply via the Supabase SQL editor or `supabase db` against the project.
-- Idempotent where practical (CREATE OR REPLACE / IF [NOT] EXISTS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a. Remove the dead greenlitAt column (status is tracked on EVENT.status now).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."EVENT" DROP COLUMN IF EXISTS "greenlitAt";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1e. Persisted, human-readable confirmation reference on each booking.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."BOOKINGS" ADD COLUMN IF NOT EXISTS reference text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b + 1e. create_pledge: store a reference, and persist the greenlit transition
-- (sticky: only early_bird -> greenlit, never back) once the hype threshold is met.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_pledge(p_event_id uuid, p_qty integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=auth.uid(); v_event record; v_settings record; v_early record; v_greenlit record;
  v_active int; v_early_sold int; v_early_avail int; v_ec int; v_gc int;
  v_booking_id bigint; v_item_id bigint; v_total numeric:=0; v_now timestamptz:=now();
  v_reference text;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_event from public."EVENT" where id=p_event_id;
  if not found then return json_build_object('error','not_found'); end if;
  if v_event.status='cancelled' then return json_build_object('error','event_cancelled'); end if;
  if v_event."hostId"=v_uid then return json_build_object('error','own_event'); end if;
  if exists(select 1 from public."BOOKINGS" b join public."TICKETS" t on t."bookingId"=b.id
      where b."userId"=v_uid and b."eventId"=p_event_id and b."deletedAt" is null and t.status in('active','used'))
  then return json_build_object('error','active_booking_exists'); end if;
  select * into v_settings from public."EVENT_SETTINGS" where "eventId"=p_event_id;
  select * into v_early    from public."PRICE_STATUSES" where "eventId"=p_event_id and "statusName"='early_bird';
  select * into v_greenlit from public."PRICE_STATUSES" where "eventId"=p_event_id and "statusName"='greenlit';
  select count(*)::int into v_active from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
    where b."eventId"=p_event_id and t.status in('active','used') and b."deletedAt" is null;
  if v_active+p_qty > v_settings."maxCapacity" then return json_build_object('error','not_enough_tickets'); end if;
  select count(*)::int into v_early_sold from public."TICKETS" t
    join public."BOOKING_ITEMS" bi on bi.id=t."bookingItemId" join public."BOOKINGS" b on b.id=t."bookingId"
    where bi."priceStatusId"=v_early.id and t.status in('active','used') and b."deletedAt" is null;
  v_early_avail:=greatest(0,v_early."ticketCapacity"-v_early_sold);
  v_ec:=least(v_early_avail,p_qty); v_gc:=p_qty-v_ec;
  v_reference:='PF-'||upper(substr(p_event_id::text,1,4))||'-'||lpad((floor(random()*9000)+1000)::int::text,4,'0');
  insert into public."BOOKINGS"("userId","eventId","amountPaid","refundedAmount",status,reference,"capturedAt","createdAt","updatedAt")
  values(v_uid,p_event_id,0,0,'captured',v_reference,v_now,v_now,v_now) returning id into v_booking_id;
  if v_ec>0 then
    insert into public."BOOKING_ITEMS"("bookingId","priceStatusId",quantity,"unitPrice",subtotal,"createdAt")
    values(v_booking_id,v_early.id,v_ec,v_early.price,v_early.price*v_ec,v_now) returning id into v_item_id;
    v_total:=v_total+v_early.price*v_ec;
    for i in 1..v_ec loop
      insert into public."TICKETS"("bookingId","bookingItemId","qrCode",status,"createdAt")
      values(v_booking_id,v_item_id,'PF-'||gen_random_uuid()::text,'active',v_now);
    end loop;
  end if;
  if v_gc>0 then
    insert into public."BOOKING_ITEMS"("bookingId","priceStatusId",quantity,"unitPrice",subtotal,"createdAt")
    values(v_booking_id,v_greenlit.id,v_gc,v_greenlit.price,v_greenlit.price*v_gc,v_now) returning id into v_item_id;
    v_total:=v_total+v_greenlit.price*v_gc;
    for i in 1..v_gc loop
      insert into public."TICKETS"("bookingId","bookingItemId","qrCode",status,"createdAt")
      values(v_booking_id,v_item_id,'PF-'||gen_random_uuid()::text,'active',v_now);
    end loop;
  end if;
  update public."BOOKINGS" set "amountPaid"=v_total,"updatedAt"=v_now where id=v_booking_id;
  -- Sticky greenlit: persist on the event row the moment the threshold is met/exceeded.
  if v_event.status='early_bird' and (v_active+p_qty) >= v_settings."hypeThreshold" then
    update public."EVENT" set status='greenlit',"updatedAt"=v_now where id=p_event_id and status='early_bird';
  end if;
  return json_build_object('status','ok','bookingId',v_booking_id::text,'reference',v_reference);
end; $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. get_events: prefer the persisted EVENT.status; keep endDate/threshold as a
-- safety net so older rows still surface correctly.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_events()
 RETURNS SETOF json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object(
    'id',                 e.id,
    'hostId',             e."hostId",
    'title',              coalesce(e.title,''),
    'description',        coalesce(e.description,''),
    'location',           coalesce(e.location,''),
    'imageUrl',           coalesce(e."imageUrl",''),
    'startDate',          e."startDate",
    'endDate',            e."endDate",
    'deadlineAt',         es.deadline,
    'hypeThreshold',      es."hypeThreshold",
    'maxCapacity',        es."maxCapacity",
    'organiser_name',     coalesce(u.name,''),
    'derived_status', case
      when e.status = 'cancelled' then 'cancelled'
      when e.status = 'greenlit' then 'greenlit'
      when e."endDate" < now() then 'completed'
      when (select count(*) from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
            where b."eventId"=e.id and t.status in('active','used') and b."deletedAt" is null
           ) >= es."hypeThreshold" then 'greenlit'
      else 'early_bird' end,
    'active_ticket_count',(select count(*)::int from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
                           where b."eventId"=e.id and t.status in('active','used') and b."deletedAt" is null),
    'statuses',(select json_agg(json_build_object(
        'statusName',ps."statusName",'price',ps.price,'ticketCapacity',ps."ticketCapacity",
        'sold',(select count(*)::int from public."TICKETS" t2
                join public."BOOKING_ITEMS" bi on bi.id=t2."bookingItemId"
                join public."BOOKINGS" b2 on b2.id=t2."bookingId"
                where bi."priceStatusId"=ps.id and t2.status in('active','used') and b2."deletedAt" is null)
      ) order by ps."statusName" asc)
      from public."PRICE_STATUSES" ps where ps."eventId"=e.id)
  )
  from public."EVENT" e
  join public."USER" u on u.id=e."hostId"
  join public."EVENT_SETTINGS" es on es."eventId"=e.id
  order by e."createdAt" desc;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1c. cancel_event: soft-cancel + refund live bookings, capture the reason.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_event(p_event_id uuid, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_now timestamptz:=now();
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if not exists(select 1 from public."EVENT" where id=p_event_id and "hostId"=v_uid) then
    return json_build_object('error','not_found'); end if;
  if coalesce(btrim(p_reason),'')='' then return json_build_object('error','reason_required'); end if;
  -- Refund the active tickets of every live booking on this event.
  update public."TICKETS" t set status='refunded',"refundedAt"=v_now
    from public."BOOKINGS" b
    where b.id=t."bookingId" and b."eventId"=p_event_id and b."deletedAt" is null and t.status in('active','used');
  -- Mark bookings refunded but keep them visible (deletedAt stays null) so backers
  -- see the cancellation in their profile's "cancelled" tab. Revenue stays 0.
  update public."BOOKINGS"
    set "refundedAmount"="amountPaid","refundedAt"=v_now,"updatedAt"=v_now
    where "eventId"=p_event_id and "deletedAt" is null;
  update public."EVENT"
    set status='cancelled',"cancelledAt"=v_now,"cancellationReason"=p_reason,"updatedAt"=v_now
    where id=p_event_id;
  return json_build_object('status','ok');
end; $function$;

GRANT EXECUTE ON FUNCTION public.cancel_event(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1d. create_event / update_event: server-authoritative capacity + threshold and
-- server-side validation (greenlit > early, end > start, deadline before start,
-- start/deadline in the future). Client-supplied threshold/maxCapacity ignored.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_event(p_title text, p_description text, p_location text, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamp with time zone, p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_event_id uuid; v_user record;
  v_max int; v_threshold int;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_user from public."USER" where id=v_uid;
  if v_user.role!='organiser' then return json_build_object('error','not_organiser'); end if;
  -- Validation (authoritative; the frontend mirrors these for UX).
  if p_greenlit_price <= p_early_price then return json_build_object('error','price_order'); end if;
  if p_end_date <= p_start_date then return json_build_object('error','bad_schedule'); end if;
  if p_deadline >= p_start_date then return json_build_object('error','deadline_after_start'); end if;
  if p_start_date <= now() or p_deadline <= now() then return json_build_object('error','not_future'); end if;
  -- Capacity/threshold are derived, never trusted from the client.
  v_threshold := p_early_capacity;
  v_max := p_early_capacity + p_greenlit_capacity;
  insert into public."EVENT"("hostId",title,description,location,"startDate","endDate","imageUrl",status,"createdAt","updatedAt")
  values(v_uid,p_title,p_description,p_location,p_start_date,p_end_date,p_image_url,'early_bird',now(),now())
  returning id into v_event_id;
  insert into public."EVENT_SETTINGS"("eventId","hypeThreshold","maxCapacity",deadline,"createdAt","updatedAt")
  values(v_event_id,v_threshold,v_max,p_deadline,now(),now());
  insert into public."PRICE_STATUSES"("eventId","statusName",price,"ticketCapacity","createdAt") values
    (v_event_id,'early_bird',p_early_price,p_early_capacity,now()),
    (v_event_id,'greenlit',p_greenlit_price,p_greenlit_capacity,now());
  return json_build_object('status','ok','eventId',v_event_id::text);
end; $function$;

CREATE OR REPLACE FUNCTION public.update_event(p_event_id uuid, p_title text, p_description text, p_location text, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamp with time zone, p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_event record; v_max int; v_threshold int;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_event from public."EVENT" where id=p_event_id and "hostId"=v_uid;
  if not found then return json_build_object('error','not_found'); end if;
  -- Always enforce price ordering and schedule.
  if p_greenlit_price <= p_early_price then return json_build_object('error','price_order'); end if;
  if p_end_date <= p_start_date then return json_build_object('error','bad_schedule'); end if;
  -- Deadline / future checks only while still in early_bird (greenlit locks them).
  if v_event.status='early_bird' then
    if p_deadline >= p_start_date then return json_build_object('error','deadline_after_start'); end if;
    if p_start_date <= now() or p_deadline <= now() then return json_build_object('error','not_future'); end if;
  end if;
  v_threshold := p_early_capacity;
  v_max := p_early_capacity + p_greenlit_capacity;
  update public."EVENT" set title=p_title,description=p_description,location=p_location,
    "startDate"=p_start_date,"endDate"=p_end_date,"imageUrl"=p_image_url,"updatedAt"=now() where id=p_event_id;
  update public."EVENT_SETTINGS" set "hypeThreshold"=v_threshold,"maxCapacity"=v_max,
    deadline=p_deadline,"updatedAt"=now() where "eventId"=p_event_id;
  update public."PRICE_STATUSES" set price=p_early_price,"ticketCapacity"=p_early_capacity
    where "eventId"=p_event_id and "statusName"='early_bird';
  update public."PRICE_STATUSES" set price=p_greenlit_price,"ticketCapacity"=p_greenlit_capacity
    where "eventId"=p_event_id and "statusName"='greenlit';
  return json_build_object('status','ok');
end; $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- One-time backfill: the create_pledge transition only fires on new pledges, so
-- flip any existing open event whose active tickets already meet the threshold.
-- Idempotent (only touches early_bird rows).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public."EVENT" e
SET status='greenlit', "updatedAt"=now()
FROM public."EVENT_SETTINGS" es
WHERE es."eventId"=e.id
  AND e.status='early_bird'
  AND (e."endDate" IS NULL OR e."endDate" >= now())
  AND (SELECT count(*) FROM public."TICKETS" t JOIN public."BOOKINGS" b ON b.id=t."bookingId"
       WHERE b."eventId"=e.id AND t.status IN ('active','used') AND b."deletedAt" IS NULL) >= es."hypeThreshold";
