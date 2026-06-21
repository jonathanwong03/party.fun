-- Migration: expire_overdue_events() — cancels + refunds early_bird events whose
-- deadline passed while still under the hype threshold. Called on a schedule by the
-- backend (service-role). Refund mirrors cancel_event (deletedAt stays null so
-- backers keep the entry in their "cancelled" tab); reason = 'missed_threshold'.
CREATE OR REPLACE FUNCTION public.expire_overdue_events()
 RETURNS TABLE(event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_now timestamptz := now(); v_ids uuid[];
begin
  select array_agg(e.id) into v_ids
  from public."EVENT" e
  join public."EVENT_SETTINGS" es on es."eventId" = e.id
  where e.status = 'early_bird'
    and es.deadline < v_now
    and (select count(*)::int from public."TICKETS" t
         join public."BOOKINGS" b on b.id = t."bookingId"
         where b."eventId" = e.id and t.status in ('active','used') and b."deletedAt" is null
        ) < es."hypeThreshold";

  if v_ids is null then return; end if;

  update public."TICKETS" t set status = 'refunded', "refundedAt" = v_now
    from public."BOOKINGS" b
    where b.id = t."bookingId" and b."eventId" = any(v_ids)
      and b."deletedAt" is null and t.status in ('active','used');

  update public."BOOKINGS"
    set "refundedAmount" = "amountPaid", "refundedAt" = v_now, "updatedAt" = v_now
    where "eventId" = any(v_ids) and "deletedAt" is null;

  update public."EVENT"
    set status = 'cancelled', "cancelledAt" = v_now, "cancellationReason" = 'missed_threshold', "updatedAt" = v_now
    where id = any(v_ids);

  return query select unnest(v_ids);
end; $function$;

REVOKE EXECUTE ON FUNCTION public.expire_overdue_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_overdue_events() TO service_role;
