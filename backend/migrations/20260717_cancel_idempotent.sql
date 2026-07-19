-- ── Idempotent cancellation (double-refund fix) ──────────────────────────────
-- cancel_event and admin_cancel_event re-run their wallet-refund loop unconditionally: a
-- booking still has deletedAt IS NULL and amountPaid > 0 after a cancel (only refundedAmount is
-- set), so a SECOND call refunds every wallet backer AGAIN. Add an already-cancelled short-circuit
-- at the top of each so a re-cancel is a clean no-op. Bodies are otherwise UNCHANGED from
-- 20260617_refunds_per_method.sql (cancel_event) and 20260714_admin_cancel_reason_min1.sql
-- (admin_cancel_event). Signatures are unchanged, so CREATE OR REPLACE is enough (no OID drop).
-- Card refunds are already idempotent (services/stripeRefunds.js guards on stripeRefundId).

CREATE OR REPLACE FUNCTION public.cancel_event(p_event_id uuid, p_reason text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_now timestamptz:=now(); rec record; v_bal numeric; v_start timestamptz; v_status text;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select "startDate", status into v_start, v_status from public."EVENT" where id=p_event_id and "hostId"=v_uid;
  if not found then return json_build_object('error','not_found'); end if;
  -- Idempotent: an already-cancelled event must not refund its backers a second time.
  if v_status = 'cancelled' then return json_build_object('status','ok','alreadyCancelled',true); end if;
  if v_start <= v_now then return json_build_object('error','event_started'); end if;
  if coalesce(btrim(p_reason),'')='' then return json_build_object('error','reason_required'); end if;
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
  update public."EVENT" set status='cancelled',"cancelledAt"=v_now,"cancellationReason"=p_reason,"updatedAt"=v_now where id=p_event_id;
  return json_build_object('status','ok');
end; $function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_event(p_event_id uuid, p_reason text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_now timestamptz:=now(); rec record; v_bal numeric; v_status text;
begin
  if not public.is_admin() then return json_build_object('error','not_admin'); end if;
  if length(btrim(coalesce(p_reason,''))) < 1 then return json_build_object('error','reason_required'); end if;
  select status into v_status from public."EVENT" where id=p_event_id;
  if not found then return json_build_object('error','not_found'); end if;
  -- Idempotent: an already-cancelled event must not refund its backers a second time.
  if v_status = 'cancelled' then return json_build_object('status','ok','alreadyCancelled',true); end if;
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
