-- Relax admin_cancel_event's reason requirement from >= 10 chars to >= 1 char.
-- The AI chatbot (and moderation UI) accept any non-empty reason for an admin
-- deletion; the previous 10-char minimum rejected short reasons like "Not nice."
-- with a generic failure. Body is otherwise unchanged from 20260622_admin_role.sql.
CREATE OR REPLACE FUNCTION public.admin_cancel_event(p_event_id uuid, p_reason text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_now timestamptz:=now(); rec record; v_bal numeric;
begin
  if not public.is_admin() then return json_build_object('error','not_admin'); end if;
  if length(btrim(coalesce(p_reason,''))) < 1 then return json_build_object('error','reason_required'); end if;
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
