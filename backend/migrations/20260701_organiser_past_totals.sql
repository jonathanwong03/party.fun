-- Migration: organiser "past events" aggregates for get_analytics().
--   organiser.past -> { tickets, revenue, profit } summed over the organiser's
--   COMPLETED events only (status='completed'); grows as events complete.
--   profit = revenue - base operational costs, the cost formula mirroring the
--   base categories in backend/services/revenuePredictor.js operationalCosts().
-- Only the organiser (myev / v_org) block changes from 20260630; global + user
-- logic is unchanged. SECURITY DEFINER for cross-organiser global ranking.

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
      select e.id, e.title, e.status, coalesce(es."maxCapacity",0) as capacity,
        (select count(*) from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
           where b."eventId"=e.id and b."deletedAt" is null and t.status in ('active','used')) as tickets_sold,
        (select coalesce(sum(b."amountPaid"-b."refundedAmount"),0) from public."BOOKINGS" b
           where b."eventId"=e.id and b."deletedAt" is null) as revenue
      from public."EVENT" e left join public."EVENT_SETTINGS" es on es."eventId"=e.id
      where e."hostId"=v_uid
    ), myev_cost as (
      -- base operational cost per event (mirrors revenuePredictor base categories)
      select id, title, status, capacity, tickets_sold, revenue,
        greatest(150, 4*capacity)
        + 8*tickets_sold
        + greatest(120, 4*tickets_sold)
        + greatest(120, 2*tickets_sold)
        + (80 + 0.5*tickets_sold)
        + greatest(50, 0.08*revenue)
        + (0.034*revenue + 0.5*tickets_sold) as cost
      from myev
    )
    select json_build_object(
      'perEvent', coalesce((select json_agg(x) from (
          select title, tickets_sold as "ticketsSold", capacity, tickets_sold as projected, revenue
          from myev_cost order by tickets_sold desc) x), '[]'::json),
      'pledgesByDay', coalesce((select json_agg(x) from (
          select to_char(b."createdAt",'YYYY-MM-DD') as day, count(*) as count
          from public."BOOKINGS" b join public."EVENT" e on e.id=b."eventId"
          where e."hostId"=v_uid and b."deletedAt" is null and b."createdAt" >= now()-interval '90 days'
          group by 1 order by 1) x), '[]'::json),
      'totals', (select json_build_object('events', count(*), 'revenue', coalesce(sum(revenue),0), 'attendees', coalesce(sum(tickets_sold),0)) from myev_cost),
      'past', (select json_build_object(
          'tickets', coalesce(sum(tickets_sold),0),
          'revenue', coalesce(sum(revenue),0),
          'profit', coalesce(sum(revenue - cost),0))
        from myev_cost where status = 'completed')
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
    'spendByDay', coalesce((select json_agg(x) from (
        select to_char(b."createdAt",'YYYY-MM-DD') as day, sum(b."amountPaid"-b."refundedAmount") as amount
        from public."BOOKINGS" b where b."userId"=v_uid and b."deletedAt" is null and b."createdAt" >= now()-interval '90 days'
        group by 1 order by 1) x), '[]'::json),
    'totals', (select json_build_object(
        'joined', count(distinct b."eventId") filter (where e.status <> 'cancelled'),
        'upcoming', count(distinct b."eventId") filter (where e."startDate" > now() and e.status <> 'cancelled'),
        'spent', coalesce(sum(b."amountPaid"-b."refundedAmount"),0))
      from public."BOOKINGS" b join public."EVENT" e on e.id=b."eventId"
      where b."userId"=v_uid and b."deletedAt" is null)
  ) into v_user;

  return json_build_object('role', v_role, 'global', v_global, 'organiser', v_org, 'user', v_user);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.get_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics() TO authenticated;
