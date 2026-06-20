-- Migration: wallet-only refunds, completion payouts, cancel-after-start guard,
-- organiser "hide" flag. Applies on top of the Stripe wallet migration.

-- Columns: hide flag + payout marker on EVENT.
ALTER TABLE public."EVENT"
  ADD COLUMN IF NOT EXISTS "hostHidden" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "disbursedAt" timestamptz;

-- Hide a (cancelled) event from the organiser's dashboard; backers keep their record.
CREATE OR REPLACE FUNCTION public.hide_event(p_event_id uuid)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  update public."EVENT" set "hostHidden"=true, "updatedAt"=now() where id=p_event_id and "hostId"=v_uid;
  if not found then return json_build_object('error','not_found'); end if;
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.hide_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hide_event(uuid) TO authenticated;

-- Pay out greenlit events past their end time → organiser wallet; mark completed.
CREATE OR REPLACE FUNCTION public.complete_due_events()
 RETURNS TABLE(event_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_now timestamptz := now(); rec record; v_net numeric; v_bal numeric;
begin
  for rec in select e.id, e."hostId" from public."EVENT" e
             where e.status='greenlit' and e."endDate" < v_now and e."disbursedAt" is null loop
    select coalesce(sum(b."amountPaid" - b."refundedAmount"),0) into v_net
      from public."BOOKINGS" b where b."eventId"=rec.id and b."deletedAt" is null;
    if v_net > 0 then
      update public."USER" set "walletBalance"="walletBalance"+v_net where id=rec."hostId" returning "walletBalance" into v_bal;
      insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
        values(rec."hostId",'payout','event',v_net,v_bal,rec.id);
    end if;
    update public."EVENT" set status='completed', "disbursedAt"=v_now, "updatedAt"=v_now where id=rec.id;
    event_id := rec.id; return next;
  end loop;
end; $function$;
REVOKE EXECUTE ON FUNCTION public.complete_due_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_due_events() TO service_role;

-- cancel_event: block once started; refund EVERY live booking to the buyer's wallet.
CREATE OR REPLACE FUNCTION public.cancel_event(p_event_id uuid, p_reason text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_now timestamptz:=now(); rec record; v_bal numeric; v_start timestamptz;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select "startDate" into v_start from public."EVENT" where id=p_event_id and "hostId"=v_uid;
  if not found then return json_build_object('error','not_found'); end if;
  if v_start <= v_now then return json_build_object('error','event_started'); end if;
  if coalesce(btrim(p_reason),'')='' then return json_build_object('error','reason_required'); end if;
  for rec in select b."userId", b."amountPaid" from public."BOOKINGS" b
             where b."eventId"=p_event_id and b."deletedAt" is null and b."amountPaid">0 loop
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

-- expire_overdue_events + get_events (hostHidden + completed-status) were also
-- updated to refund all live bookings to the wallet — see DB for current bodies.
