-- Migration: university display support and SIM/SIT membership list.

ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_university_check;
ALTER TABLE public."USER" ADD CONSTRAINT user_university_check
  CHECK (university IS NULL OR university IN ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT'));

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
