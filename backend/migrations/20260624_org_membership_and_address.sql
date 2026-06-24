-- Migration: organiser membership gating + event address + co-organiser email-only.
-- Run in the Supabase SQL editor.

-- ── 1. Event address ─────────────────────────────────────────────────────────
ALTER TABLE public."EVENT" ADD COLUMN IF NOT EXISTS address text;

-- ── 2. Organiser membership columns on USER ──────────────────────────────────
ALTER TABLE public."USER" ADD COLUMN IF NOT EXISTS university text;
ALTER TABLE public."USER" ADD COLUMN IF NOT EXISTS "memberType" text;
ALTER TABLE public."USER" ADD COLUMN IF NOT EXISTS "orgId" text;

-- Backfill existing organisers (so the organiser-required CHECK below passes).
-- Each gets a unique 9-digit professor staff ID; university by known email else SMU.
WITH orgs AS (
  SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn
  FROM public."USER" WHERE role = 'organiser' AND "orgId" IS NULL
)
UPDATE public."USER" u
SET "memberType" = 'professor',
    university = CASE u.email
      WHEN 'partyfundemo@gmail.com' THEN 'NTU'
      WHEN 'organiser@smu.edu.sg' THEN 'SMU'
      ELSE 'SMU' END,
    "orgId" = to_char(900000000 + o.rn, 'FM000000000')
FROM orgs o WHERE u.id = o.id;

-- Constraints (added after backfill).
CREATE UNIQUE INDEX IF NOT EXISTS user_org_id_unique ON public."USER"("orgId") WHERE "orgId" IS NOT NULL;

ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_university_check;
ALTER TABLE public."USER" ADD CONSTRAINT user_university_check
  CHECK (university IS NULL OR university IN ('NUS','NTU','SMU','SUTD','SIT','SUSS'));

ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_member_type_check;
ALTER TABLE public."USER" ADD CONSTRAINT user_member_type_check
  CHECK ("memberType" IS NULL OR "memberType" IN ('student','instructor','professor'));

ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_org_id_format_check;
ALTER TABLE public."USER" ADD CONSTRAINT user_org_id_format_check
  CHECK (
    "orgId" IS NULL
    OR ("memberType" = 'student' AND "orgId" ~ '^[A-Za-z][0-9]{8}[A-Za-z]$')
    OR ("memberType" IN ('instructor','professor') AND "orgId" ~ '^[0-9]{9}$')
  );

ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_organiser_membership_check;
ALTER TABLE public."USER" ADD CONSTRAINT user_organiser_membership_check
  CHECK (role <> 'organiser' OR (university IS NOT NULL AND "memberType" IS NOT NULL AND "orgId" IS NOT NULL));

GRANT UPDATE (university, "memberType", "orgId") ON public."USER" TO authenticated;
-- (Self-update still gated by RLS; these are set at signup via the trigger / RPC.)

-- ── 3. New-user trigger: carry membership fields from signup metadata ─────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_base text; v_username text;
begin
  v_base := coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1));
  v_username := v_base;
  if exists (select 1 from public."USER" where username = v_username) then
    v_username := v_base || '_' || left(new.id::text, 8);
  end if;
  insert into public."USER" (id, email, name, username, role, "avatarUrl", "socialLink", contact, onboarded,
                             university, "memberType", "orgId", "createdAt")
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    v_username,
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    coalesce(new.raw_user_meta_data->>'avatarUrl', new.raw_user_meta_data->>'avatar_url'),
    nullif(new.raw_user_meta_data->>'telegram',''),
    nullif(new.raw_user_meta_data->>'phone',''),
    (new.raw_user_meta_data ? 'role'),
    nullif(new.raw_user_meta_data->>'university',''),
    nullif(new.raw_user_meta_data->>'memberType',''),
    nullif(new.raw_user_meta_data->>'orgId',''),
    now()
  );
  return new;
end; $function$;

-- ── 4. Finish-setup RPC: organiser must also supply university + ID ───────────
DROP FUNCTION IF EXISTS public.complete_oauth_signup(text, text);
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
    if v_univ is null or v_univ not in ('NUS','NTU','SMU','SUTD','SIT','SUSS') then return json_build_object('error','invalid_university'); end if;
    if v_type not in ('student','instructor','professor') then return json_build_object('error','invalid_member_type'); end if;
    if v_type = 'student' and v_id !~ '^[A-Za-z][0-9]{8}[A-Za-z]$' then return json_build_object('error','invalid_matric'); end if;
    if v_type in ('instructor','professor') and v_id !~ '^[0-9]{9}$' then return json_build_object('error','invalid_staff_id'); end if;
  else
    v_univ := null; v_type := null; v_id := null;
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

-- ── 5. Co-organiser invite by EMAIL only ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_coorganiser(p_event_id uuid, p_identifier text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_identifier text := btrim(coalesce(p_identifier, ''));
  v_event record; v_invitee record; v_invite record;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_authenticated'); end if;
  select e.*, coalesce(u.username, u.name, '') as owner_username
    into v_event
  from public."EVENT" e join public."USER" u on u.id = e."hostId"
  where e.id = p_event_id and e."hostId" = v_uid;
  if not found then return jsonb_build_object('error', 'not_owner'); end if;

  -- Email only: usernames are not unique, emails are.
  select * into v_invitee from public."USER"
  where role = 'organiser' and lower(email) = lower(v_identifier)
  limit 1;
  if not found then return jsonb_build_object('error', 'invitee_not_found'); end if;
  if v_invitee.id = v_uid then return jsonb_build_object('error', 'invite_self'); end if;

  select * into v_invite from public."EVENT_CO_ORGANISER_INVITES"
  where "eventId" = p_event_id and "inviteeId" = v_invitee.id and status = 'accepted';
  if not found then
    insert into public."EVENT_CO_ORGANISER_INVITES"("eventId","ownerId","inviteeId",status,"invitedAt","respondedAt")
    values(p_event_id, v_uid, v_invitee.id, 'pending', now(), null)
    on conflict ("eventId","inviteeId") do update
      set "ownerId"=excluded."ownerId", status='pending', "invitedAt"=now(), "respondedAt"=null
    returning * into v_invite;
  end if;

  return jsonb_build_object(
    'id', v_invite.id::text, 'eventId', p_event_id::text, 'eventTitle', v_event.title,
    'ownerId', v_uid::text, 'ownerUsername', v_event.owner_username,
    'ownerEmail', (select email from public."USER" where id = v_uid),
    'inviteeId', v_invitee.id::text, 'inviteeUsername', coalesce(v_invitee.username, v_invitee.name, ''),
    'inviteeEmail', v_invitee.email, 'status', v_invite.status,
    'invitedAt', v_invite."invitedAt", 'respondedAt', v_invite."respondedAt", 'direction', 'outgoing'
  );
end; $function$;
REVOKE EXECUTE ON FUNCTION public.invite_coorganiser(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_coorganiser(uuid, text) TO authenticated;

-- ── 6. create_event / update_event accept p_address ──────────────────────────
DROP FUNCTION IF EXISTS public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer);
CREATE OR REPLACE FUNCTION public.create_event(p_title text, p_description text, p_location text, p_start_date timestamptz, p_end_date timestamptz, p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamptz, p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer, p_address text DEFAULT '')
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
  insert into public."EVENT"("hostId",title,description,location,address,"startDate","endDate","imageUrl",status,"createdAt","updatedAt")
  values(v_uid,p_title,p_description,p_location,nullif(btrim(coalesce(p_address,'')),''),p_start_date,p_end_date,p_image_url,'early_bird',now(),now())
  returning id into v_event_id;
  insert into public."EVENT_SETTINGS"("eventId","hypeThreshold","maxCapacity",deadline,"createdAt","updatedAt")
  values(v_event_id,v_threshold,v_max,p_deadline,now(),now());
  insert into public."PRICE_STATUSES"("eventId","statusName",price,"ticketCapacity","createdAt") values
    (v_event_id,'early_bird',p_early_price,p_early_capacity,now()),
    (v_event_id,'greenlit',p_greenlit_price,p_greenlit_capacity,now());
  return json_build_object('status','ok','eventId',v_event_id::text);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text) TO authenticated;

DROP FUNCTION IF EXISTS public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer);
CREATE OR REPLACE FUNCTION public.update_event(p_event_id uuid, p_title text, p_description text, p_location text, p_start_date timestamptz, p_end_date timestamptz, p_image_url text, p_hype_threshold integer, p_max_capacity integer, p_deadline timestamptz, p_early_price numeric, p_early_capacity integer, p_greenlit_price numeric, p_greenlit_capacity integer, p_address text DEFAULT '')
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  v_threshold := p_early_capacity; v_max := p_early_capacity + p_greenlit_capacity;
  update public."EVENT" set title=p_title, description=p_description, location=p_location,
    address=nullif(btrim(coalesce(p_address,'')),''),
    "startDate"=p_start_date, "endDate"=p_end_date, "imageUrl"=p_image_url, "updatedAt"=now()
    where id = p_event_id;
  update public."EVENT_SETTINGS" set "hypeThreshold"=v_threshold, "maxCapacity"=v_max, deadline=p_deadline, "updatedAt"=now()
    where "eventId" = p_event_id;
  update public."PRICE_STATUSES" set price=p_early_price, "ticketCapacity"=p_early_capacity where "eventId"=p_event_id and "statusName"='early_bird';
  update public."PRICE_STATUSES" set price=p_greenlit_price, "ticketCapacity"=p_greenlit_capacity where "eventId"=p_event_id and "statusName"='greenlit';
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer, text) TO authenticated;

-- ── 7. get_events returns address ─────────────────────────────────────────────
-- Re-create with the same body plus 'address'. (Only the added line differs.)
CREATE OR REPLACE FUNCTION public.get_events()
 RETURNS SETOF json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id', e.id, 'hostId', e."hostId", 'title', coalesce(e.title, ''),
    'description', coalesce(e.description, ''), 'location', coalesce(e.location, ''),
    'address', coalesce(e.address, ''),
    'imageUrl', coalesce(e."imageUrl", ''), 'startDate', e."startDate", 'endDate', e."endDate",
    'deadlineAt', es.deadline, 'hypeThreshold', es."hypeThreshold", 'maxCapacity', es."maxCapacity",
    'organiser_name', coalesce(u.name, u.username, ''), 'hostHidden', e."hostHidden",
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
