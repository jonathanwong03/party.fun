-- ── Optimistic concurrency on event edits ────────────────────────────────────
-- Two co-organisers (or an organiser + an admin) editing the same event was silent last-write-wins.
-- update_event now takes p_expected_updated_at: the EVENT."updatedAt" the editor's form was based
-- on. If the row changed since (someone else saved first), it returns 'conflict' and writes nothing,
-- so the frontend can ask them to reload. The param DEFAULTs NULL → callers that omit it (or pass
-- null) skip the check, so nothing that doesn't opt in regresses.
--
-- The body is otherwise UNCHANGED from 20260716_event_coordinates.sql. The signature changes (a new
-- trailing param), so drop the prior update_event overloads by OID first — CREATE OR REPLACE never
-- drops other signatures, and a stale overload would make the call ambiguous (the lesson from
-- 20260717_payment_rpc_authz.sql).

DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_event'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $do$;

CREATE OR REPLACE FUNCTION public.update_event(
  p_event_id uuid, p_title text, p_description text, p_location text, p_start_date timestamptz, p_end_date timestamptz,
  p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamptz,
  p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer,
  p_address text DEFAULT '', p_restrict_university boolean DEFAULT false,
  p_hype_driven boolean DEFAULT false, p_base_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_costs jsonb DEFAULT '{}'::jsonb,
  p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL,
  -- The updatedAt the editor's form was based on. NULL = skip the optimistic-concurrency check.
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_event record; v_settings record; v_max int; v_threshold int; v_host_univ text; v_new_hype boolean;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_event from public."EVENT" where id = p_event_id and public.can_manage_event(id, v_uid);
  if not found then return json_build_object('error','not_found'); end if;
  -- Optimistic concurrency: refuse if the row moved on since the editor loaded it.
  if p_expected_updated_at is not null and v_event."updatedAt" is distinct from p_expected_updated_at then
    return json_build_object('error','conflict');
  end if;
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
REVOKE EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb, double precision, double precision, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb, double precision, double precision, timestamptz) TO authenticated;
