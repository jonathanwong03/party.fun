-- Migration: personal analytics clarity for get_analytics().
--   user.totals.joined  -> "All events joined": distinct non-cancelled events the
--                          user joined (past included), excluding self-removed bookings.
--   user.totals.upcoming-> "Current events joined": upcoming non-cancelled events.
--   user.totals.spent   -> total paid net of refunds (give-aways stay counted;
--                          organiser-cancelled events are refunded so net to 0).
--   user.spendByDay     -> NEW daily spend series so the frontend can toggle
--                          spending by day / week / month.
-- Only the v_user block changes from 20260617; global + organiser logic is unchanged.
-- SECURITY DEFINER so the global ranking can read across all organisers' bookings.

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
