-- Hype-Driven Pricing slice #04: expose curve fields on get_events + give_away elasticity.
-- Active ticket counts exclude given_away tickets, so releasing tickets lowers the curve.

CREATE OR REPLACE FUNCTION public.give_away_tickets(p_booking_id bigint, p_quantity integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_booking record;
  v_active int;
  v_now timestamptz := now();
  v_ticket record;
begin
  if v_uid is null then return json_build_object('error', 'not_authenticated'); end if;
  if p_quantity is null or p_quantity <= 0 then return json_build_object('error', 'invalid_quantity'); end if;

  select * into v_booking
  from public."BOOKINGS"
  where id = p_booking_id and "userId" = v_uid and "deletedAt" is null;
  if not found then return json_build_object('error', 'not_found'); end if;

  select count(*)::int into v_active
  from public."TICKETS" t
  where t."bookingId" = p_booking_id and t.status in ('active', 'used');

  if p_quantity > v_active then return json_build_object('error', 'invalid_quantity'); end if;

  for v_ticket in
    select t.id from public."TICKETS" t
    where t."bookingId" = p_booking_id and t.status = 'active'
    order by t.id
    limit p_quantity
  loop
    update public."TICKETS"
    set status = 'given_away', "givenAwayAt" = v_now
    where id = v_ticket.id;
  end loop;

  select count(*)::int into v_active
  from public."TICKETS" t
  where t."bookingId" = p_booking_id and t.status in ('active', 'used');

  if v_active = 0 then
    update public."BOOKINGS" set status = 'given_away', "updatedAt" = v_now where id = p_booking_id;
  else
    update public."BOOKINGS" set status = 'partially_given_away', "updatedAt" = v_now where id = p_booking_id;
  end if;

  return json_build_object('status', 'ok');
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.give_away_tickets(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.give_away_tickets(bigint, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_events()
 RETURNS SETOF json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object(
    'id',                 e.id,
    'hostId',             e."hostId",
    'hostHidden',         coalesce(e."hostHidden", false),
    'title',              coalesce(e.title,''),
    'description',        coalesce(e.description,''),
    'location',           coalesce(e.location,''),
    'imageUrl',           coalesce(e."imageUrl",''),
    'startDate',          e."startDate",
    'endDate',            e."endDate",
    'deadlineAt',         es.deadline,
    'hypeThreshold',      es."hypeThreshold",
    'maxCapacity',        es."maxCapacity",
    'hypeDrivenPricing',  coalesce(es."hypeDrivenPricing", false),
    'basePrice',          es."basePrice",
    'maxPrice',           es."maxPrice",
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
    'current_dynamic_price', case
      when coalesce(es."hypeDrivenPricing", false) then
        public.hype_ticket_price(es."basePrice", es."maxPrice", es."maxCapacity",
          (select count(*)::int from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
           where b."eventId"=e.id and t.status in('active','used') and b."deletedAt" is null))
      else null end,
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
