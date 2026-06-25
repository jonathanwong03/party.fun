-- Migration: event-level co-organisers.
-- Co-organisers remain USER.role = 'organiser'. This table only grants
-- accepted organiser accounts limited management access for one event.

CREATE TABLE IF NOT EXISTS public."EVENT_CO_ORGANISER_INVITES" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId" uuid NOT NULL REFERENCES public."EVENT"(id) ON DELETE CASCADE,
  "ownerId" uuid NOT NULL REFERENCES public."USER"(id) ON DELETE CASCADE,
  "inviteeId" uuid NOT NULL REFERENCES public."USER"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  "invitedAt" timestamptz NOT NULL DEFAULT now(),
  "respondedAt" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS event_co_organiser_invites_event_invitee_idx
  ON public."EVENT_CO_ORGANISER_INVITES"("eventId", "inviteeId");

ALTER TABLE public."EVENT_CO_ORGANISER_INVITES" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coorganiser_invites_visible" ON public."EVENT_CO_ORGANISER_INVITES";
CREATE POLICY "coorganiser_invites_visible"
  ON public."EVENT_CO_ORGANISER_INVITES"
  FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) IN ("ownerId", "inviteeId")
    OR public.is_admin()
  );

GRANT SELECT ON public."EVENT_CO_ORGANISER_INVITES" TO authenticated;
GRANT ALL ON public."EVENT_CO_ORGANISER_INVITES" TO service_role;

CREATE OR REPLACE FUNCTION public.is_event_owner(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public."EVENT" e
      WHERE e.id = p_event_id AND e."hostId" = p_user_id
    );
$function$;
REVOKE EXECUTE ON FUNCTION public.is_event_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_event_owner(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_event_coorganiser(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public."EVENT_CO_ORGANISER_INVITES" i
      WHERE i."eventId" = p_event_id
        AND i."inviteeId" = p_user_id
        AND i.status = 'accepted'
    );
$function$;
REVOKE EXECUTE ON FUNCTION public.is_event_coorganiser(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_event_coorganiser(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_event(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM public."EVENT" e WHERE e.id = p_event_id AND e."hostId" = p_user_id)
      OR EXISTS (SELECT 1 FROM public."USER" u WHERE u.id = p_user_id AND u.role = 'admin')
      OR public.is_event_coorganiser(p_event_id, p_user_id)
    );
$function$;
REVOKE EXECUTE ON FUNCTION public.can_manage_event(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_event(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_coorganiser_invites()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id::text,
    'eventId', i."eventId"::text,
    'eventTitle', e.title,
    'ownerId', i."ownerId"::text,
    'ownerUsername', coalesce(owner.username, owner.name, ''),
    'ownerEmail', owner.email,
    'inviteeId', i."inviteeId"::text,
    'inviteeUsername', coalesce(invitee.username, invitee.name, ''),
    'inviteeEmail', invitee.email,
    'status', i.status,
    'invitedAt', i."invitedAt",
    'respondedAt', i."respondedAt",
    'direction', CASE WHEN i."inviteeId" = (select auth.uid()) THEN 'incoming' ELSE 'outgoing' END
  ) ORDER BY i."invitedAt" DESC), '[]'::jsonb)
  FROM public."EVENT_CO_ORGANISER_INVITES" i
  JOIN public."EVENT" e ON e.id = i."eventId"
  JOIN public."USER" owner ON owner.id = i."ownerId"
  JOIN public."USER" invitee ON invitee.id = i."inviteeId"
  WHERE (select auth.uid()) IN (i."ownerId", i."inviteeId") OR public.is_admin();
$function$;
REVOKE EXECUTE ON FUNCTION public.get_coorganiser_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coorganiser_invites() TO authenticated;

CREATE OR REPLACE FUNCTION public.invite_coorganiser(p_event_id uuid, p_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_identifier text := btrim(coalesce(p_identifier, ''));
  v_event record;
  v_invitee record;
  v_invite record;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_authenticated'); end if;
  select e.*, coalesce(u.username, u.name, '') as owner_username
    into v_event
  from public."EVENT" e
  join public."USER" u on u.id = e."hostId"
  where e.id = p_event_id and e."hostId" = v_uid;
  if not found then return jsonb_build_object('error', 'not_owner'); end if;

  select *
    into v_invitee
  from public."USER"
  where role = 'organiser'
    and (lower(email) = lower(v_identifier) or username = v_identifier)
  order by case when username = v_identifier then 0 else 1 end
  limit 1;
  if not found then return jsonb_build_object('error', 'invitee_not_found'); end if;
  if v_invitee.id = v_uid then return jsonb_build_object('error', 'invite_self'); end if;

  select * into v_invite
  from public."EVENT_CO_ORGANISER_INVITES"
  where "eventId" = p_event_id and "inviteeId" = v_invitee.id and status = 'accepted';

  if not found then
    insert into public."EVENT_CO_ORGANISER_INVITES"("eventId", "ownerId", "inviteeId", status, "invitedAt", "respondedAt")
    values(p_event_id, v_uid, v_invitee.id, 'pending', now(), null)
    on conflict ("eventId", "inviteeId") do update
      set "ownerId" = excluded."ownerId",
          status = 'pending',
          "invitedAt" = now(),
          "respondedAt" = null
    returning * into v_invite;
  end if;

  return jsonb_build_object(
    'id', v_invite.id::text,
    'eventId', p_event_id::text,
    'eventTitle', v_event.title,
    'ownerId', v_uid::text,
    'ownerUsername', v_event.owner_username,
    'ownerEmail', (select email from public."USER" where id = v_uid),
    'inviteeId', v_invitee.id::text,
    'inviteeUsername', coalesce(v_invitee.username, v_invitee.name, ''),
    'inviteeEmail', v_invitee.email,
    'status', v_invite.status,
    'invitedAt', v_invite."invitedAt",
    'respondedAt', v_invite."respondedAt",
    'direction', 'outgoing'
  );
end; $function$;
REVOKE EXECUTE ON FUNCTION public.invite_coorganiser(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_coorganiser(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_coorganiser_invite(p_invite_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_invite record;
  v_status text;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_authenticated'); end if;
  if p_action not in ('accept', 'decline') then return jsonb_build_object('error', 'invalid_action'); end if;
  select * into v_invite from public."EVENT_CO_ORGANISER_INVITES" where id = p_invite_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_invite."inviteeId" <> v_uid then return jsonb_build_object('error', 'not_invitee'); end if;
  if v_invite.status <> 'pending' then return jsonb_build_object('error', 'not_pending'); end if;

  v_status := case when p_action = 'accept' then 'accepted' else 'declined' end;
  update public."EVENT_CO_ORGANISER_INVITES"
    set status = v_status, "respondedAt" = now()
    where id = p_invite_id;

  return jsonb_build_object('status', 'ok', 'eventId', v_invite."eventId"::text);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.respond_coorganiser_invite(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_coorganiser_invite(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_events()
 RETURNS SETOF json
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id', e.id,
    'hostId', e."hostId",
    'title', coalesce(e.title, ''),
    'description', coalesce(e.description, ''),
    'location', coalesce(e.location, ''),
    'imageUrl', coalesce(e."imageUrl", ''),
    'startDate', e."startDate",
    'endDate', e."endDate",
    'deadlineAt', es.deadline,
    'hypeThreshold', es."hypeThreshold",
    'maxCapacity', es."maxCapacity",
    'organiser_name', coalesce(u.name, u.username, ''),
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
      WHEN (
        SELECT count(*)
        FROM public."TICKETS" t
        JOIN public."BOOKINGS" b ON b.id = t."bookingId"
        WHERE b."eventId" = e.id
          AND t.status IN ('active', 'used')
          AND b."deletedAt" IS NULL
      ) >= es."hypeThreshold" THEN 'greenlit'
      ELSE 'early_bird'
    END,
    'active_ticket_count', (
      SELECT count(*)::int
      FROM public."TICKETS" t
      JOIN public."BOOKINGS" b ON b.id = t."bookingId"
      WHERE b."eventId" = e.id
        AND t.status IN ('active', 'used')
        AND b."deletedAt" IS NULL
    ),
    'statuses', (
      SELECT json_agg(json_build_object(
        'statusName', ps."statusName",
        'price', ps.price,
        'ticketCapacity', ps."ticketCapacity",
        'sold', (
          SELECT count(*)::int
          FROM public."TICKETS" t2
          JOIN public."BOOKING_ITEMS" bi ON bi.id = t2."bookingItemId"
          JOIN public."BOOKINGS" b2 ON b2.id = t2."bookingId"
          WHERE bi."priceStatusId" = ps.id
            AND t2.status IN ('active', 'used')
            AND b2."deletedAt" IS NULL
        )
      ) ORDER BY ps."statusName" ASC)
      FROM public."PRICE_STATUSES" ps
      WHERE ps."eventId" = e.id
    )
  )
  FROM public."EVENT" e
  JOIN public."USER" u ON u.id = e."hostId"
  JOIN public."EVENT_SETTINGS" es ON es."eventId" = e.id
  ORDER BY e."createdAt" DESC;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_events() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_event(
  p_event_id uuid,
  p_title text,
  p_description text,
  p_location text,
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone,
  p_image_url text,
  p_hype_threshold integer,
  p_max_capacity integer,
  p_deadline timestamp with time zone,
  p_early_price numeric,
  p_early_capacity integer,
  p_greenlit_price numeric,
  p_greenlit_capacity integer
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_event record; v_max int; v_threshold int;
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
  v_threshold := p_early_capacity;
  v_max := p_early_capacity + p_greenlit_capacity;
  update public."EVENT" set title = p_title, description = p_description, location = p_location,
    "startDate" = p_start_date, "endDate" = p_end_date, "imageUrl" = p_image_url, "updatedAt" = now()
    where id = p_event_id;
  update public."EVENT_SETTINGS" set "hypeThreshold" = v_threshold, "maxCapacity" = v_max,
    deadline = p_deadline, "updatedAt" = now()
    where "eventId" = p_event_id;
  update public."PRICE_STATUSES" set price = p_early_price, "ticketCapacity" = p_early_capacity
    where "eventId" = p_event_id and "statusName" = 'early_bird';
  update public."PRICE_STATUSES" set price = p_greenlit_price, "ticketCapacity" = p_greenlit_capacity
    where "eventId" = p_event_id and "statusName" = 'greenlit';
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, integer, integer, timestamp with time zone, numeric, integer, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, integer, integer, timestamp with time zone, numeric, integer, numeric, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_event_tickets(p_event_id uuid)
 RETURNS TABLE("qrCode" text, username text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.can_manage_event(p_event_id, auth.uid()) then
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
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_id bigint; v_status text; v_title text; v_attendee text;
  v_start timestamptz; v_end timestamptz; v_now timestamptz := now();
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select t.id, t.status, e.title, u.username, e."startDate", e."endDate"
    into v_id, v_status, v_title, v_attendee, v_start, v_end
  from public."TICKETS" t
  join public."BOOKINGS" b on b.id=t."bookingId"
  join public."EVENT" e on e.id=b."eventId"
  join public."USER" u on u.id=b."userId"
  where t."qrCode" = btrim(p_qr) and public.can_manage_event(e.id, v_uid);
  if not found then return json_build_object('error','not_found'); end if;
  if v_status = 'used' then return json_build_object('error','already_used','attendee',v_attendee,'eventTitle',v_title); end if;
  if v_status = 'given_away' then return json_build_object('error','given_away'); end if;
  if v_status <> 'active' then return json_build_object('error','refunded'); end if;
  if v_now < v_start then return json_build_object('error','too_early','eventTitle',v_title); end if;
  if v_now > v_end then return json_build_object('error','too_late','eventTitle',v_title); end if;
  update public."TICKETS" set status='used' where id=v_id;
  return json_build_object('status','ok','checkedIn',1,'attendee',v_attendee,'eventTitle',v_title);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.check_in_ticket(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_ticket(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in_booking(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_bid bigint; v_title text; v_attendee text;
  v_start timestamptz; v_end timestamptz; v_now timestamptz := now(); v_active int; v_total int; v_used int;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select b.id, e.title, u.username, e."startDate", e."endDate"
    into v_bid, v_title, v_attendee, v_start, v_end
  from public."BOOKINGS" b
  join public."EVENT" e on e.id=b."eventId"
  join public."USER" u on u.id=b."userId"
  where b."qrToken"::text = btrim(p_token)
    and public.can_manage_event(e.id, v_uid)
    and b."deletedAt" is null;
  if not found then return json_build_object('error','not_found'); end if;
  if v_now < v_start then return json_build_object('error','too_early','eventTitle',v_title); end if;
  if v_now > v_end then return json_build_object('error','too_late','eventTitle',v_title); end if;
  select count(*) filter (where status='active'), count(*) filter (where status in ('active','used')), count(*) filter (where status='used')
    into v_active, v_total, v_used from public."TICKETS" where "bookingId"=v_bid;
  if v_active = 0 then
    return json_build_object('error', case when v_used>0 then 'already_used' else 'nothing_to_check_in' end,'attendee',v_attendee,'eventTitle',v_title);
  end if;
  update public."TICKETS" set status='used' where "bookingId"=v_bid and status='active';
  return json_build_object('status','ok','checkedIn',v_active,'total',v_total,'attendee',v_attendee,'eventTitle',v_title);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.check_in_booking(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_booking(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_all_attendees()
 RETURNS TABLE("eventTitle" text, username text, email text, contact text, "socialLink" text, "ticketCount" bigint, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    where public.can_manage_event(e.id, auth.uid()) and b."deletedAt" is null
    order by e.title, u.username;
end; $function$;
REVOKE EXECUTE ON FUNCTION public.get_all_attendees() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_all_attendees() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_event_attendees_private(p_event_id uuid)
 RETURNS TABLE(username text, email text, contact text, "socialLink" text, "avatarUrl" text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.can_manage_event(p_event_id, auth.uid()) then
    raise exception 'not_host' using errcode = '42501';
  end if;
  return query
    select distinct u.username, u.email, u.contact, u."socialLink", u."avatarUrl"
    from public."BOOKINGS" b
    join public."USER" u on u.id = b."userId"
    where b."eventId" = p_event_id
      and b."deletedAt" is null
      and exists (
        select 1 from public."TICKETS" t
        where t."bookingId" = b.id and t.status in ('active','used')
      );
end; $function$;
REVOKE EXECUTE ON FUNCTION public.get_event_attendees_private(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_attendees_private(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_hosted_revenue()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id,
      coalesce((
        SELECT sum(b."amountPaid" - b."refundedAmount")
        FROM public."BOOKINGS" b
        WHERE b."eventId" = e.id AND b."deletedAt" IS NULL
      ), 0) AS revenue
    FROM public."EVENT" e
    WHERE public.can_manage_event(e.id, (select auth.uid()))
  )
  SELECT jsonb_build_object(
    'events', coalesce(jsonb_agg(jsonb_build_object('eventId', id, 'revenue', revenue)), '[]'::jsonb),
    'totalRevenue', coalesce(sum(revenue), 0)
  ) FROM ev;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_hosted_revenue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hosted_revenue() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_analytics()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_role text; v_global json; v_org json; v_user json; v_platform json;
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
      where public.can_manage_event(e.id, v_uid)
    )
    select json_build_object(
      'perEvent', coalesce((select json_agg(x) from (
          select title, tickets_sold as "ticketsSold", capacity, tickets_sold as projected, revenue
          from myev order by tickets_sold desc) x), '[]'::json),
      'pledgesByDay', coalesce((select json_agg(x) from (
          select to_char(b."createdAt",'YYYY-MM-DD') as day, count(*) as count
          from public."BOOKINGS" b join myev e on e.id=b."eventId"
          where b."deletedAt" is null and b."createdAt" >= now()-interval '90 days'
          group by 1 order by 1) x), '[]'::json),
      'totals', (select json_build_object('events', count(*), 'revenue', coalesce(sum(revenue),0), 'attendees', coalesce(sum(tickets_sold),0)) from myev)
    ) into v_org;
  else v_org := null; end if;

  if v_role = 'admin' then
    select json_build_object(
      'totals', json_build_object(
        'events', (select count(*) from public."EVENT"),
        'revenue', (select coalesce(sum(b."amountPaid"-b."refundedAmount"),0) from public."BOOKINGS" b where b."deletedAt" is null),
        'attendees', (select count(*) from public."TICKETS" t where t.status in ('active','used'))
      ),
      'topOrganisers', coalesce((select json_agg(x) from (
        select u.username as name, count(distinct e.id) as events,
          count(*) filter (where t.status in ('active','used')) as tickets
        from public."EVENT" e
        join public."USER" u on u.id=e."hostId"
        left join public."BOOKINGS" b on b."eventId"=e.id and b."deletedAt" is null
        left join public."TICKETS" t on t."bookingId"=b.id
        group by u.id, u.username order by tickets desc nulls last limit 10
      ) x), '[]'::json)
    ) into v_platform;
  else v_platform := null; end if;

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

  return json_build_object('role', v_role, 'global', v_global, 'organiser', v_org, 'user', v_user, 'platform', v_platform);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.get_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics() TO authenticated;
