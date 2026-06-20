-- Migration: refunds follow the payment method.
--   wallet-paid bookings  -> credited to the in-app wallet (in these RPCs)
--   card-paid bookings    -> refundedAmount marked here; the backend issues the
--                            real Stripe refund (services/stripeRefunds.js)
-- Supersedes the "all refunds to wallet" version.

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

CREATE OR REPLACE FUNCTION public.expire_overdue_events()
 RETURNS TABLE(event_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_now timestamptz := now(); v_ids uuid[]; rec record; v_bal numeric;
begin
  select array_agg(e.id) into v_ids
  from public."EVENT" e join public."EVENT_SETTINGS" es on es."eventId" = e.id
  where e.status = 'early_bird' and es.deadline < v_now
    and (select count(*)::int from public."TICKETS" t join public."BOOKINGS" b on b.id = t."bookingId"
         where b."eventId" = e.id and t.status in ('active','used') and b."deletedAt" is null) < es."hypeThreshold";
  if v_ids is null then return; end if;
  for rec in select b."userId", b."amountPaid", b."eventId" from public."BOOKINGS" b
             where b."eventId"=any(v_ids) and b."deletedAt" is null and b."paymentMethod"='wallet' and b."amountPaid">0 loop
    update public."USER" set "walletBalance"="walletBalance"+rec."amountPaid" where id=rec."userId" returning "walletBalance" into v_bal;
    insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
      values(rec."userId",'refund','wallet',rec."amountPaid",v_bal,rec."eventId");
  end loop;
  update public."TICKETS" t set status = 'refunded', "refundedAt" = v_now from public."BOOKINGS" b
    where b.id = t."bookingId" and b."eventId" = any(v_ids) and b."deletedAt" is null and t.status in ('active','used');
  update public."BOOKINGS" set "refundedAmount" = "amountPaid", "refundedAt" = v_now, "updatedAt" = v_now
    where "eventId" = any(v_ids) and "deletedAt" is null;
  update public."EVENT" set status = 'cancelled', "cancelledAt" = v_now, "cancellationReason" = 'missed_threshold', "updatedAt" = v_now
    where id = any(v_ids);
  return query select unnest(v_ids);
end; $function$;

DROP FUNCTION IF EXISTS public.get_event_backer_contacts(uuid);
CREATE OR REPLACE FUNCTION public.get_event_backer_contacts(p_event_id uuid)
 RETURNS TABLE(email text, username text, role text, "paymentMethod" text, "refundAmount" numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or auth.uid() <> (select "hostId" from public."EVENT" where id = p_event_id) then
    raise exception 'not_host' using errcode = '42501';
  end if;
  return query
    select u.email, u.username, u.role, b."paymentMethod", coalesce(sum(b."refundedAmount"),0)::numeric
    from public."BOOKINGS" b join public."USER" u on u.id = b."userId"
    where b."eventId" = p_event_id and b."deletedAt" is null
    group by u.email, u.username, u.role, b."paymentMethod";
end; $function$;
REVOKE EXECUTE ON FUNCTION public.get_event_backer_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_backer_contacts(uuid) TO authenticated;
