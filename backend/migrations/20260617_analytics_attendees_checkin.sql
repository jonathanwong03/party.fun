-- Migration: analytics + cross-event attendees + ticket check-in.
--   get_analytics()       -> role-aware JSON (global discovery, organiser own-events, personal)
--   get_all_attendees()   -> every backer across the calling organiser's events
--   get_event_tickets()   -> tickets for one of the caller's events (check-in list)
--   check_in_ticket()     -> mark a ticket 'used' by QR code (host-scoped)
-- All SECURITY DEFINER so the global ranking can read across all organisers' bookings.

CREATE OR REPLACE FUNCTION public.get_analytics()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_role text; v_global json; v_org json; v_user json;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select role into v_role from public."USER" where id = v_uid;

  select json_build_object(
    'topEvents', coalesce((select json_agg(x) from (
        select e.id as "eventId", e.title, u.username as "hostName",
               (select count(*) from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
                  where b."eventId"=e.id and b."deletedAt" is null and t.status in ('active','used')) as "ticketsSold",
               (select count(distinct b."userId") from public."BOOKINGS" b
                  where b."eventId"=e.id and b."deletedAt" is null) as pledgers,
               case when coalesce(es."hypeThreshold",0)>0
                    then round((select count(*) from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
                                 where b."eventId"=e.id and b."deletedAt" is null and t.status in ('active','used')) * 100.0 / es."hypeThreshold")
                    else 0 end as "hypePct",
               e.status
        from public."EVENT" e
        left join public."EVENT_SETTINGS" es on es."eventId"=e.id
        left join public."USER" u on u.id=e."hostId"
        where e.status <> 'cancelled'
        order by "ticketsSold" desc, pledgers desc limit 10) x), '[]'::json),
    'pledgesByDay', coalesce((select json_agg(x) from (
        select to_char(b."createdAt",'YYYY-MM-DD') as day, count(*) as count
        from public."BOOKINGS" b where b."deletedAt" is null and b."createdAt" >= now()-interval '90 days'
        group by 1 order by 1) x), '[]'::json),
    'statusBreakdown', coalesce((select json_agg(x) from (
        select status, count(*) as count from public."EVENT" group by status order by status) x), '[]'::json),
    'priceBuckets', coalesce((select json_agg(x) from (
        select bucket, count(*) as count from (
          select case when ps.price < 15 then 'Under $15' when ps.price <= 25 then '$15-$25' else 'Over $25' end as bucket
          from public."EVENT" e join public."PRICE_STATUSES" ps on ps."eventId"=e.id and ps."statusName"='early_bird'
        ) s group by bucket order by bucket) x), '[]'::json)
  ) into v_global;

  if v_role = 'organiser' then
    with myev as (
      select e.id, e.title, coalesce(es."maxCapacity",0) as capacity,
        (select count(*) from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
           where b."eventId"=e.id and b."deletedAt" is null and t.status in ('active','used')) as tickets_sold,
        (select coalesce(sum(b."amountPaid"-b."refundedAmount"),0) from public."BOOKINGS" b
           where b."eventId"=e.id and b."deletedAt" is null) as revenue
      from public."EVENT" e left join public."EVENT_SETTINGS" es on es."eventId"=e.id
      where e."hostId"=v_uid
    )
    select json_build_object(
      'perEvent', coalesce((select json_agg(x) from (
          select title, tickets_sold as "ticketsSold", capacity, tickets_sold as projected, revenue
          from myev order by tickets_sold desc) x), '[]'::json),
      'pledgesByDay', coalesce((select json_agg(x) from (
          select to_char(b."createdAt",'YYYY-MM-DD') as day, count(*) as count
          from public."BOOKINGS" b join public."EVENT" e on e.id=b."eventId"
          where e."hostId"=v_uid and b."deletedAt" is null and b."createdAt" >= now()-interval '90 days'
          group by 1 order by 1) x), '[]'::json),
      'totals', (select json_build_object('events', count(*), 'revenue', coalesce(sum(revenue),0), 'attendees', coalesce(sum(tickets_sold),0)) from myev)
    ) into v_org;
  else v_org := null; end if;

  select json_build_object(
    'pledgesByDay', coalesce((select json_agg(x) from (
        select to_char(b."createdAt",'YYYY-MM-DD') as day, count(*) as count
        from public."BOOKINGS" b where b."userId"=v_uid and b."deletedAt" is null
        group by 1 order by 1) x), '[]'::json),
    'spendByMonth', coalesce((select json_agg(x) from (
        select to_char(b."createdAt",'YYYY-MM') as month, sum(b."amountPaid"-b."refundedAmount") as amount
        from public."BOOKINGS" b where b."userId"=v_uid and b."deletedAt" is null
        group by 1 order by 1) x), '[]'::json),
    'totals', (select json_build_object(
        'joined', count(distinct b."eventId"),
        'upcoming', count(distinct b."eventId") filter (where e."startDate" > now() and e.status <> 'cancelled'),
        'spent', coalesce(sum(b."amountPaid"-b."refundedAmount"),0))
      from public."BOOKINGS" b join public."EVENT" e on e.id=b."eventId"
      where b."userId"=v_uid and b."deletedAt" is null)
  ) into v_user;

  return json_build_object('role', v_role, 'global', v_global, 'organiser', v_org, 'user', v_user);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.get_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_all_attendees()
 RETURNS TABLE("eventTitle" text, username text, email text, contact text, "socialLink" text, "ticketCount" bigint, status text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  return query
    select e.title, u.username, u.email, u.contact, u."socialLink",
      (select count(*) from public."TICKETS" t where t."bookingId"=b.id and t.status in ('active','used')) as ticket_count,
      b.status
    from public."BOOKINGS" b
    join public."EVENT" e on e.id=b."eventId"
    join public."USER" u on u.id=b."userId"
    where e."hostId"=auth.uid() and b."deletedAt" is null
    order by e.title, u.username;
end; $function$;
REVOKE EXECUTE ON FUNCTION public.get_all_attendees() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_all_attendees() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_event_tickets(p_event_id uuid)
 RETURNS TABLE("qrCode" text, username text, status text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or auth.uid() <> (select "hostId" from public."EVENT" where id=p_event_id) then
    raise exception 'not_host' using errcode='42501';
  end if;
  return query
    select t."qrCode", u.username, t.status
    from public."TICKETS" t
    join public."BOOKINGS" b on b.id=t."bookingId"
    join public."USER" u on u.id=b."userId"
    where b."eventId"=p_event_id and b."deletedAt" is null and t.status in ('active','used')
    order by t.status, u.username;
end; $function$;
REVOKE EXECUTE ON FUNCTION public.get_event_tickets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_tickets(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in_ticket(p_qr text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_id bigint; v_status text; v_title text; v_attendee text;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select t.id, t.status, e.title, u.username into v_id, v_status, v_title, v_attendee
  from public."TICKETS" t
  join public."BOOKINGS" b on b.id=t."bookingId"
  join public."EVENT" e on e.id=b."eventId"
  join public."USER" u on u.id=b."userId"
  where t."qrCode"=btrim(p_qr) and e."hostId"=v_uid;
  if not found then return json_build_object('error','not_found'); end if;
  if v_status = 'used' then return json_build_object('error','already_used','attendee',v_attendee,'eventTitle',v_title); end if;
  if v_status <> 'active' then return json_build_object('error','refunded'); end if;
  update public."TICKETS" set status='used' where id=v_id;
  return json_build_object('status','ok','attendee',v_attendee,'eventTitle',v_title);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.check_in_ticket(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_ticket(text) TO authenticated;
