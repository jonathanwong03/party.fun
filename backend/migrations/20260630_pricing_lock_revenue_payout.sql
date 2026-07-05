-- Pricing model lock + ticket revenue payout.
-- Operational cost columns remain only as compatibility fields; organisers no longer enter costs.

UPDATE public."EVENT_SETTINGS"
SET "costVenue" = 0,
    "costFnb" = 0,
    "costAv" = 0,
    "costTalent" = 0,
    "costMarketing" = 0,
    "costStaffing" = 0,
    "costDecor" = 0,
    "updatedAt" = now();

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
         0,0,0,0,0,0,0,now(),now());
  insert into public."PRICE_STATUSES"("eventId","statusName",price,"ticketCapacity","createdAt") values
    (v_event_id,'early_bird', case when v_hype then p_base_price else p_early_price end, p_early_capacity, now()),
    (v_event_id,'greenlit',   case when v_hype then p_max_price  else p_greenlit_price end, p_greenlit_capacity, now());
  return json_build_object('status','ok','eventId',v_event_id::text);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb) TO authenticated;

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
REVOKE EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text, boolean, boolean, numeric, numeric, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_due_events()
 RETURNS TABLE(event_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_now timestamptz := now(); rec record; v_revenue numeric; v_bal numeric;
begin
  for rec in select e.id, e."hostId" from public."EVENT" e
             where e.status='greenlit' and e."endDate" < v_now and e."disbursedAt" is null loop
    select coalesce(sum(b."amountPaid" - b."refundedAmount"),0) into v_revenue
      from public."BOOKINGS" b where b."eventId"=rec.id and b."deletedAt" is null;
    -- Simulated bank payout of ticket revenue. Operational costs are outside party.fun.
    if v_revenue > 0 then
      select "walletBalance" into v_bal from public."USER" where id=rec."hostId";
      insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
        values(rec."hostId",'payout','bank',v_revenue,coalesce(v_bal,0),rec.id);
    end if;
    update public."EVENT" set status='completed', "costTotal"=0, "profit"=v_revenue,
      "disbursedAt"=v_now, "updatedAt"=v_now where id=rec.id;
    event_id := rec.id; return next;
  end loop;
end; $function$;
REVOKE EXECUTE ON FUNCTION public.complete_due_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_due_events() TO service_role;
