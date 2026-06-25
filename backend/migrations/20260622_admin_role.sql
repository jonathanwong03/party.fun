-- Migration: platform "admin" role (moderator).
--   * USER.role now allows 'admin'; is_admin() helper; EVENT.cancelledBy attribution.
--   * Admins may act on ANY event: update_event / check_in_ticket / check_in_booking /
--     get_event_tickets ownership guard is now (hostId=auth.uid() OR is_admin()).
--   * admin_cancel_event(uuid,text): moderation cancel of any event (reason >= 10 chars),
--     refunds like cancel_event, sets cancelledBy='admin'.
--   * create_pledge blocks admins (admin_no_purchase).
--   * get_analytics gains an admin 'platform' section.
-- Admin accounts are seeded out-of-band via backend/scripts/seedAdmins.js.
-- NOTE: the full bodies of update_event / check_in_* / get_event_tickets / create_pledge /
-- get_analytics live in the DB; only the admin-relevant changes are summarised here.

ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS "USER_role_check";
ALTER TABLE public."USER" ADD CONSTRAINT "USER_role_check" CHECK (role = ANY (ARRAY['user','organiser','admin']));
ALTER TABLE public."EVENT" ADD COLUMN IF NOT EXISTS "cancelledBy" text;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ select exists(select 1 from public."USER" where id = auth.uid() and role = 'admin') $function$;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- admin_cancel_event: moderation cancel of any event (mandatory >=10-char reason).
CREATE OR REPLACE FUNCTION public.admin_cancel_event(p_event_id uuid, p_reason text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_now timestamptz:=now(); rec record; v_bal numeric;
begin
  if not public.is_admin() then return json_build_object('error','not_admin'); end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then return json_build_object('error','reason_too_short'); end if;
  if not exists(select 1 from public."EVENT" where id=p_event_id) then return json_build_object('error','not_found'); end if;
  for rec in select b."userId", b."amountPaid" from public."BOOKINGS" b
             where b."eventId"=p_event_id and b."deletedAt" is null and b."paymentMethod"='wallet' and b."amountPaid">0 loop
    update public."USER" set "walletBalance"="walletBalance"+rec."amountPaid" where id=rec."userId" returning "walletBalance" into v_bal;
    insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
      values(rec."userId",'refund','wallet',rec."amountPaid",v_bal,p_event_id);
  end loop;
  update public."TICKETS" t set status='refunded',"refundedAt"=v_now from public."BOOKINGS" b
    where b.id=t."bookingId" and b."eventId"=p_event_id and b."deletedAt" is null and t.status in('active','used');
  update public."BOOKINGS" set "refundedAmount"="amountPaid","refundedAt"=v_now,"updatedAt"=v_now
    where "eventId"=p_event_id and "deletedAt" is null;
  update public."EVENT" set status='cancelled',"cancelledAt"=v_now,"cancellationReason"=p_reason,"cancelledBy"='admin',"updatedAt"=v_now where id=p_event_id;
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_event(uuid, text) TO authenticated;

-- Admin allowance pattern applied to existing RPCs (ownership guard):
--   update_event / check_in_ticket / get_event_tickets:  ... and (e."hostId"=auth.uid() OR public.is_admin())
--   check_in_booking:                                     ... and (e."hostId"=v_uid OR public.is_admin())
-- create_pledge: add near the top →  if public.is_admin() then return json_build_object('error','admin_no_purchase'); end if;
-- get_analytics: add a v_platform block when role='admin' (totals + topOrganisers) and include 'platform' in the result.
