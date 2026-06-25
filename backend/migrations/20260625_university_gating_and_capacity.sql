-- Migration: university‑restricted events + attendee university capture + one‑time change.
-- Run in the Supabase SQL editor (after 20260625_location_university_display.sql).
-- After running this, (re)run backend/scripts/demo_seed.sql for the demo data.

-- ── 1. Event restriction column ───────────────────────────────────────────────
ALTER TABLE public."EVENT" ADD COLUMN IF NOT EXISTS "restrictedUniversity" text;
ALTER TABLE public."EVENT" DROP CONSTRAINT IF EXISTS event_restricted_university_check;
ALTER TABLE public."EVENT" ADD CONSTRAINT event_restricted_university_check
  CHECK ("restrictedUniversity" IS NULL OR "restrictedUniversity" IN ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT'));

-- ── 2. One‑time university change flag on USER ────────────────────────────────
ALTER TABLE public."USER" ADD COLUMN IF NOT EXISTS "universityChanged" boolean NOT NULL DEFAULT false;

-- ── 3. Attendees pick their university; change it once ────────────────────────
CREATE OR REPLACE FUNCTION public.change_my_university(p_university text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_univ text := nullif(btrim(coalesce(p_university,'')),'');
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if v_univ is not null and v_univ not in ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT') then
    return json_build_object('error','invalid_university');
  end if;
  -- Allowed exactly once: only flips while "universityChanged" is still false.
  update public."USER" set university = v_univ, "universityChanged" = true
    where id = v_uid and "universityChanged" = false;
  if not found then return json_build_object('error','already_changed'); end if;
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.change_my_university(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_my_university(text) TO authenticated;

-- ── 4. Finish‑setup RPC: users may also store a university ────────────────────
CREATE OR REPLACE FUNCTION public.complete_oauth_signup(
  p_role text, p_username text,
  p_university text DEFAULT NULL, p_member_type text DEFAULT NULL, p_org_id text DEFAULT NULL
)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_name text := btrim(coalesce(p_username,''));
  v_univ text := nullif(btrim(coalesce(p_university,'')),'');
  v_type text := nullif(btrim(coalesce(p_member_type,'')),'');
  v_id   text := nullif(btrim(coalesce(p_org_id,'')),'');
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if p_role not in ('user','organiser') then return json_build_object('error','invalid_role'); end if;
  if v_name = '' then return json_build_object('error','username_required'); end if;
  if p_role = 'organiser' then
    if v_univ is null or v_univ not in ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT') then return json_build_object('error','invalid_university'); end if;
    if v_type not in ('student','instructor','professor') then return json_build_object('error','invalid_member_type'); end if;
    if v_type = 'student' and v_id !~ '^[A-Za-z][0-9]{8}[A-Za-z]$' then return json_build_object('error','invalid_matric'); end if;
    if v_type in ('instructor','professor') and v_id !~ '^[0-9]{9}$' then return json_build_object('error','invalid_staff_id'); end if;
  else
    -- Attendees: university optional (NULL = "not enrolled"); no member type / ID.
    if v_univ is not null and v_univ not in ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT') then return json_build_object('error','invalid_university'); end if;
    v_type := null; v_id := null;
  end if;
  begin
    update public."USER"
      set role = p_role, username = v_name, onboarded = true,
          university = v_univ, "memberType" = v_type, "orgId" = v_id
      where id = v_uid and onboarded = false;
  exception when unique_violation then
    return json_build_object('error', case when v_id is not null then 'org_id_taken' else 'username_taken' end);
  end;
  if not found then return json_build_object('error','already_onboarded'); end if;
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.complete_oauth_signup(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_oauth_signup(text, text, text, text, text) TO authenticated;

-- ── 5. create_event / update_event accept p_restrict_university ───────────────
DROP FUNCTION IF EXISTS public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text);
CREATE OR REPLACE FUNCTION public.create_event(p_title text, p_description text, p_location text, p_start_date timestamptz, p_end_date timestamptz, p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamptz, p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer, p_address text DEFAULT '', p_restrict_university boolean DEFAULT false)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_event_id uuid; v_user record; v_max int; v_threshold int;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_user from public."USER" where id=v_uid;
  if v_user.role!='organiser' then return json_build_object('error','not_organiser'); end if;
  if p_greenlit_price <= p_early_price then return json_build_object('error','price_order'); end if;
  if p_end_date <= p_start_date then return json_build_object('error','bad_schedule'); end if;
  if p_deadline >= p_start_date then return json_build_object('error','deadline_after_start'); end if;
  if p_start_date <= now() or p_deadline <= now() then return json_build_object('error','not_future'); end if;
  v_threshold := p_early_capacity; v_max := p_early_capacity + p_greenlit_capacity;
  insert into public."EVENT"("hostId",title,description,location,address,"restrictedUniversity","startDate","endDate","imageUrl",status,"createdAt","updatedAt")
  values(v_uid,p_title,p_description,p_location,nullif(btrim(coalesce(p_address,'')),''),
         case when p_restrict_university then v_user.university else null end,
         p_start_date,p_end_date,p_image_url,'early_bird',now(),now())
  returning id into v_event_id;
  insert into public."EVENT_SETTINGS"("eventId","hypeThreshold","maxCapacity",deadline,"createdAt","updatedAt")
  values(v_event_id,v_threshold,v_max,p_deadline,now(),now());
  insert into public."PRICE_STATUSES"("eventId","statusName",price,"ticketCapacity","createdAt") values
    (v_event_id,'early_bird',p_early_price,p_early_capacity,now()),
    (v_event_id,'greenlit',p_greenlit_price,p_greenlit_capacity,now());
  return json_build_object('status','ok','eventId',v_event_id::text);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text);
CREATE OR REPLACE FUNCTION public.update_event(p_event_id uuid, p_title text, p_description text, p_location text, p_start_date timestamptz, p_end_date timestamptz, p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamptz, p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer, p_address text DEFAULT '', p_restrict_university boolean DEFAULT false)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_event record; v_max int; v_threshold int; v_host_univ text;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_event from public."EVENT" where id = p_event_id and public.can_manage_event(id, v_uid);
  if not found then return json_build_object('error','not_found'); end if;
  if p_greenlit_price <= p_early_price then return json_build_object('error','price_order'); end if;
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
  update public."EVENT_SETTINGS" set "hypeThreshold"=v_threshold, "maxCapacity"=v_max, deadline=p_deadline, "updatedAt"=now()
    where "eventId" = p_event_id;
  update public."PRICE_STATUSES" set price=p_early_price, "ticketCapacity"=p_early_capacity where "eventId"=p_event_id and "statusName"='early_bird';
  update public."PRICE_STATUSES" set price=p_greenlit_price, "ticketCapacity"=p_greenlit_capacity where "eventId"=p_event_id and "statusName"='greenlit';
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean) TO authenticated;

-- ── 6. get_events exposes restriction + per‑viewer eligibility ────────────────
CREATE OR REPLACE FUNCTION public.get_events()
 RETURNS SETOF json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id', e.id, 'hostId', e."hostId", 'title', coalesce(e.title, ''),
    'description', coalesce(e.description, ''), 'location', coalesce(e.location, ''),
    'address', coalesce(e.address, ''),
    'imageUrl', coalesce(e."imageUrl", ''), 'startDate', e."startDate", 'endDate', e."endDate",
    'deadlineAt', es.deadline, 'hypeThreshold', es."hypeThreshold", 'maxCapacity', es."maxCapacity",
    'organiser_name', coalesce(u.name, u.username, ''), 'host_university', coalesce(u.university, ''),
    'restricted_university', coalesce(e."restrictedUniversity", ''),
    -- True when the event is open, the viewer is a guest (not logged in — they'll be asked to log in),
    -- or the signed-in viewer's recorded university matches. A logged-in non-member (incl. "not
    -- enrolled" / NULL) is false. Always a definite boolean so the frontend can gate the buy button.
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

-- ── 7. create_pledge enforces the university restriction ──────────────────────
CREATE OR REPLACE FUNCTION public.create_pledge(p_event_id uuid, p_qty integer, p_payment_method text DEFAULT 'wallet'::text, p_payment_intent_id text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=auth.uid(); v_event record; v_settings record; v_early record; v_greenlit record;
  v_active int; v_early_sold int; v_early_avail int; v_ec int; v_gc int;
  v_booking_id bigint; v_item_id bigint; v_total numeric:=0; v_now timestamptz:=now();
  v_reference text; v_bal numeric; v_qr_token uuid; v_greenlit_now boolean:=false;
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
  select count(*)::int into v_early_sold from public."TICKETS" t
    join public."BOOKING_ITEMS" bi on bi.id=t."bookingItemId" join public."BOOKINGS" b on b.id=t."bookingId"
    where bi."priceStatusId"=v_early.id and t.status in('active','used') and b."deletedAt" is null;
  v_early_avail:=greatest(0,v_early."ticketCapacity"-v_early_sold);
  v_ec:=least(v_early_avail,p_qty); v_gc:=p_qty-v_ec;
  v_total := v_ec*v_early.price + v_gc*v_greenlit.price;
  if p_payment_method = 'wallet' then
    update public."USER" set "walletBalance" = "walletBalance" - v_total
      where id = v_uid and "walletBalance" >= v_total;
    if not found then return json_build_object('error','insufficient_funds'); end if;
  end if;
  v_reference:='PF-'||upper(substr(p_event_id::text,1,4))||'-'||lpad((floor(random()*9000)+1000)::int::text,4,'0');
  insert into public."BOOKINGS"("userId","eventId","amountPaid","refundedAmount",status,reference,"paymentMethod","stripePaymentIntentId","capturedAt","createdAt","updatedAt")
  values(v_uid,p_event_id,0,0,'captured',v_reference,p_payment_method,p_payment_intent_id,v_now,v_now,v_now)
  returning id, "qrToken" into v_booking_id, v_qr_token;
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
REVOKE EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text) TO authenticated;

-- ── 8. Task 7: partyfundemo is an SMU organiser ───────────────────────────────
UPDATE public."USER" SET university='SMU' WHERE email='partyfundemo@gmail.com';
