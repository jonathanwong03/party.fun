-- ── Venue coordinates (latitude/longitude) ───────────────────────────────────
-- Closes a real gap: the frontend AddressPicker captures coordinates and sends them
-- (CreateEvent.tsx), and eventService.eventRpcArgs passes p_latitude/p_longitude to BOTH
-- create_event and update_event — but no migration ever defined them, and get_events never
-- returned them. Consequences on a database built from this folder:
--   * every create_event / update_event call fails (PostgREST resolves by named args);
--   * mapEventRow reads row.latitude → always NULL, so the agent's get_weather tool and
--     weatherController fall back to Singapore-wide weather instead of the venue's.
--
-- IDEMPOTENT and safe to run against a database that ALREADY has these (the deployed project
-- appears to have had them applied out-of-band): the columns use IF NOT EXISTS, and the
-- functions are dropped by OID before being recreated.
--
-- WHY DROP BY OID rather than plain CREATE OR REPLACE: CREATE OR REPLACE never drops OTHER
-- signatures, so adding two parameters would leave the old 19/20-arg version behind as an
-- overload and PostgREST could bind either. That is exactly the bug 20260716_remove_gst.sql
-- had to clean up for create_pledge. Dropping every overload first also makes this migration
-- correct regardless of what parameter order any out-of-band version used.
--
-- The function bodies below are otherwise UNCHANGED from 20260630_pricing_lock_revenue_payout.sql
-- (create_event, update_event) and 20260629_gst_and_costs.sql (get_events).

ALTER TABLE public."EVENT"
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- Drop EVERY overload of both functions (see note above).
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('create_event', 'update_event')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $do$;

CREATE OR REPLACE FUNCTION public.create_event(
  p_title text, p_description text, p_location text, p_start_date timestamptz, p_end_date timestamptz,
  p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamptz,
  p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer,
  p_address text DEFAULT '', p_restrict_university boolean DEFAULT false,
  p_hype_driven boolean DEFAULT false, p_base_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_costs jsonb DEFAULT '{}'::jsonb,
  -- Venue coordinates from the frontend AddressPicker. Optional: events created before
  -- this migration (and any caller that omits them) simply have NULL coords.
  p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL
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
  insert into public."EVENT"("hostId",title,description,location,address,latitude,longitude,"restrictedUniversity","startDate","endDate","imageUrl",status,"createdAt","updatedAt")
  values(v_uid,p_title,p_description,p_location,nullif(btrim(coalesce(p_address,'')),''),p_latitude,p_longitude,
         case when p_restrict_university then v_user.university else null end,
         p_start_date,p_end_date,p_image_url,'early_bird',now(),now())
  returning id into v_event_id;
  insert into public."EVENT_SETTINGS"("eventId","hypeThreshold","maxCapacity",deadline,"hypeDrivenPricing","basePrice","maxPrice",
         "costVenue","costFnb","costAv","costTalent","costMarketing","costStaffing","costDecor","createdAt","updatedAt")
  values(v_event_id,v_threshold,v_max,p_deadline,
         v_hype,
         case when v_hype then p_base_price else null end,
         case when v_hype then p_max_price else null end,
         0,0,0,0,0,0,0,now(),now());
  insert into public."PRICE_STATUSES"("eventId","statusName",price,"ticketCapacity","createdAt") values
    (v_event_id,'early_bird', case when v_hype then p_base_price else p_early_price end, p_early_capacity, now()),
    (v_event_id,'greenlit',   case when v_hype then p_max_price  else p_greenlit_price end, p_greenlit_capacity, now());
  return json_build_object('status','ok','eventId',v_event_id::text);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_event(
  p_event_id uuid, p_title text, p_description text, p_location text, p_start_date timestamptz, p_end_date timestamptz,
  p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamptz,
  p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer,
  p_address text DEFAULT '', p_restrict_university boolean DEFAULT false,
  p_hype_driven boolean DEFAULT false, p_base_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_costs jsonb DEFAULT '{}'::jsonb,
  -- Venue coordinates from the frontend AddressPicker. Optional: events created before
  -- this migration (and any caller that omits them) simply have NULL coords.
  p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_event record; v_settings record; v_max int; v_threshold int; v_host_univ text; v_new_hype boolean;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_event from public."EVENT" where id = p_event_id and public.can_manage_event(id, v_uid);
  if not found then return json_build_object('error','not_found'); end if;
  select * into v_settings from public."EVENT_SETTINGS" where "eventId" = p_event_id;

  if coalesce(p_hype_driven, false) is distinct from coalesce(v_settings."hypeDrivenPricing", false) then
    return json_build_object('error','pricing_model_locked');
  end if;
  v_new_hype := coalesce(v_settings."hypeDrivenPricing", false);

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
    latitude=p_latitude, longitude=p_longitude,
    "restrictedUniversity"=case when p_restrict_university then v_host_univ else null end,
    "startDate"=p_start_date, "endDate"=p_end_date, "imageUrl"=p_image_url, "updatedAt"=now()
    where id = p_event_id;
  update public."EVENT_SETTINGS" set "hypeThreshold"=v_threshold, "maxCapacity"=v_max, deadline=p_deadline,
    "hypeDrivenPricing"=v_new_hype,
    "basePrice"=case when v_new_hype then p_base_price else null end,
    "maxPrice"=case when v_new_hype then p_max_price else null end,
    "costVenue"=0,
    "costFnb"=0,
    "costAv"=0,
    "costTalent"=0,
    "costMarketing"=0,
    "costStaffing"=0,
    "costDecor"=0,
    "updatedAt"=now()
    where "eventId" = p_event_id;
  update public."PRICE_STATUSES" set price=case when v_new_hype then p_base_price else p_early_price end, "ticketCapacity"=p_early_capacity
    where "eventId"=p_event_id and "statusName"='early_bird';
  update public."PRICE_STATUSES" set price=case when v_new_hype then p_max_price else p_greenlit_price end, "ticketCapacity"=p_greenlit_capacity
    where "eventId"=p_event_id and "statusName"='greenlit';
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb, double precision, double precision) TO authenticated;

-- get_events: project the new columns so mapEventRow/get_weather see real coordinates.
CREATE OR REPLACE FUNCTION public.get_events()
 RETURNS SETOF json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id', e.id, 'hostId', e."hostId", 'title', coalesce(e.title, ''),
    'description', coalesce(e.description, ''), 'location', coalesce(e.location, ''),
    'address', coalesce(e.address, ''),
    'latitude', e.latitude, 'longitude', e.longitude,
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
