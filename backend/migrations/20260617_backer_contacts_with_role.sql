-- Migration: get_event_backer_contacts now also returns each backer's role, so
-- cancellation emails can greet recipients as "Hi <username> (User|Organiser),".
DROP FUNCTION IF EXISTS public.get_event_backer_contacts(uuid);

CREATE OR REPLACE FUNCTION public.get_event_backer_contacts(p_event_id uuid)
 RETURNS TABLE(email text, username text, role text, "refundAmount" numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or auth.uid() <> (select "hostId" from public."EVENT" where id = p_event_id) then
    raise exception 'not_host' using errcode = '42501';
  end if;
  return query
    select u.email, u.username, u.role, coalesce(sum(b."refundedAmount"), 0)::numeric
    from public."BOOKINGS" b
    join public."USER" u on u.id = b."userId"
    where b."eventId" = p_event_id
      and b."deletedAt" is null
    group by u.email, u.username, u.role;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_event_backer_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_backer_contacts(uuid) TO authenticated;
