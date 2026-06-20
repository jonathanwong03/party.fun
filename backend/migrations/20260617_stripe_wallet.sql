-- Migration: in-app wallet + linked-card payments (Stripe, Test mode).
-- Adds wallet balance/ledger + saved-card fields, payment-method on bookings, and
-- updates the pledge/cancel/expire RPCs so wallet payments debit/credit the wallet
-- atomically (card payments/refunds are handled by the backend via Stripe).

-- ── Schema ───────────────────────────────────────────────────────────────────
ALTER TABLE public."USER"
  ADD COLUMN IF NOT EXISTS "walletBalance" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" text,
  ADD COLUMN IF NOT EXISTS "stripePaymentMethodId" text,
  ADD COLUMN IF NOT EXISTS "cardBrand" text,
  ADD COLUMN IF NOT EXISTS "cardLast4" text;

ALTER TABLE public."BOOKINGS"
  ADD COLUMN IF NOT EXISTS "paymentMethod" text,
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" text,
  ADD COLUMN IF NOT EXISTS "stripeRefundId" text;

CREATE TABLE IF NOT EXISTS public."WALLET_TRANSACTIONS" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "userId" uuid NOT NULL REFERENCES public."USER"(id),
  type text NOT NULL,                 -- topup | pledge | refund
  source text NOT NULL,               -- wallet | card
  amount numeric NOT NULL,
  "balanceAfter" numeric NOT NULL,
  "eventId" uuid,
  "stripePaymentIntentId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."WALLET_TRANSACTIONS" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallet_txn_owner" ON public."WALLET_TRANSACTIONS";
CREATE POLICY "wallet_txn_owner" ON public."WALLET_TRANSACTIONS"
  FOR SELECT USING ((select auth.uid()) = "userId");  -- writes happen via SECURITY DEFINER RPCs

-- ── create_pledge: pay by wallet (atomic debit) or card (already charged) ─────
DROP FUNCTION IF EXISTS public.create_pledge(uuid, integer);
CREATE OR REPLACE FUNCTION public.create_pledge(
  p_event_id uuid, p_qty integer,
  p_payment_method text DEFAULT 'wallet', p_payment_intent_id text DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=auth.uid(); v_event record; v_settings record; v_early record; v_greenlit record;
  v_active int; v_early_sold int; v_early_avail int; v_ec int; v_gc int;
  v_booking_id bigint; v_item_id bigint; v_total numeric:=0; v_now timestamptz:=now();
  v_reference text; v_bal numeric;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select * into v_event from public."EVENT" where id=p_event_id;
  if not found then return json_build_object('error','not_found'); end if;
  if v_event.status='cancelled' then return json_build_object('error','event_cancelled'); end if;
  if v_event."hostId"=v_uid then return json_build_object('error','own_event'); end if;
  if exists(select 1 from public."BOOKINGS" b join public."TICKETS" t on t."bookingId"=b.id
      where b."userId"=v_uid and b."eventId"=p_event_id and b."deletedAt" is null and t.status in('active','used'))
  then return json_build_object('error','active_booking_exists'); end if;
  select * into v_settings from public."EVENT_SETTINGS" where "eventId"=p_event_id;
  select * into v_early    from public."PRICE_STATUSES" where "eventId"=p_event_id and "statusName"='early_bird';
  select * into v_greenlit from public."PRICE_STATUSES" where "eventId"=p_event_id and "statusName"='greenlit';
  select count(*)::int into v_active from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
    where b."eventId"=p_event_id and t.status in('active','used') and b."deletedAt" is null;
  if v_active+p_qty > v_settings."maxCapacity" then return json_build_object('error','not_enough_tickets'); end if;
  select count(*)::int into v_early_sold from public."TICKETS" t
    join public."BOOKING_ITEMS" bi on bi.id=t."bookingItemId" join public."BOOKINGS" b on b.id=t."bookingId"
    where bi."priceStatusId"=v_early.id and t.status in('active','used') and b."deletedAt" is null;
  v_early_avail:=greatest(0,v_early."ticketCapacity"-v_early_sold);
  v_ec:=least(v_early_avail,p_qty); v_gc:=p_qty-v_ec;
  v_total := v_ec*v_early.price + v_gc*v_greenlit.price;

  -- Wallet: debit atomically up front (rolls nothing back because no inserts yet).
  if p_payment_method = 'wallet' then
    update public."USER" set "walletBalance" = "walletBalance" - v_total
      where id = v_uid and "walletBalance" >= v_total;
    if not found then return json_build_object('error','insufficient_funds'); end if;
  end if;

  v_reference:='PF-'||upper(substr(p_event_id::text,1,4))||'-'||lpad((floor(random()*9000)+1000)::int::text,4,'0');
  insert into public."BOOKINGS"("userId","eventId","amountPaid","refundedAmount",status,reference,"paymentMethod","stripePaymentIntentId","capturedAt","createdAt","updatedAt")
  values(v_uid,p_event_id,0,0,'captured',v_reference,p_payment_method,p_payment_intent_id,v_now,v_now,v_now) returning id into v_booking_id;
  if v_ec>0 then
    insert into public."BOOKING_ITEMS"("bookingId","priceStatusId",quantity,"unitPrice",subtotal,"createdAt")
    values(v_booking_id,v_early.id,v_ec,v_early.price,v_early.price*v_ec,v_now) returning id into v_item_id;
    for i in 1..v_ec loop
      insert into public."TICKETS"("bookingId","bookingItemId","qrCode",status,"createdAt")
      values(v_booking_id,v_item_id,'PF-'||gen_random_uuid()::text,'active',v_now);
    end loop;
  end if;
  if v_gc>0 then
    insert into public."BOOKING_ITEMS"("bookingId","priceStatusId",quantity,"unitPrice",subtotal,"createdAt")
    values(v_booking_id,v_greenlit.id,v_gc,v_greenlit.price,v_greenlit.price*v_gc,v_now) returning id into v_item_id;
    for i in 1..v_gc loop
      insert into public."TICKETS"("bookingId","bookingItemId","qrCode",status,"createdAt")
      values(v_booking_id,v_item_id,'PF-'||gen_random_uuid()::text,'active',v_now);
    end loop;
  end if;
  update public."BOOKINGS" set "amountPaid"=v_total,"updatedAt"=v_now where id=v_booking_id;

  if p_payment_method = 'wallet' then
    select "walletBalance" into v_bal from public."USER" where id=v_uid;
    insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
      values(v_uid,'pledge','wallet',v_total,v_bal,p_event_id);
  end if;

  if v_event.status='early_bird' and (v_active+p_qty) >= v_settings."hypeThreshold" then
    update public."EVENT" set status='greenlit',"updatedAt"=v_now where id=p_event_id and status='early_bird';
  end if;
  return json_build_object('status','ok','bookingId',v_booking_id::text,'reference',v_reference,'amount',v_total);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text, text) TO authenticated;

-- ── wallet_topup: credit the wallet after a successful Stripe charge ──────────
CREATE OR REPLACE FUNCTION public.wallet_topup(p_amount numeric, p_payment_intent_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_bal numeric;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if p_amount is null or p_amount <= 0 then return json_build_object('error','bad_amount'); end if;
  update public."USER" set "walletBalance" = "walletBalance" + p_amount where id = v_uid returning "walletBalance" into v_bal;
  insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","stripePaymentIntentId")
    values(v_uid,'topup','card',p_amount,v_bal,p_payment_intent_id);
  return json_build_object('status','ok','balance',v_bal);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.wallet_topup(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_topup(numeric, text) TO authenticated, service_role;

-- ── cancel_event: credit wallet for wallet-paid bookings (card handled in backend)
CREATE OR REPLACE FUNCTION public.cancel_event(p_event_id uuid, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_now timestamptz:=now(); rec record; v_bal numeric;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if not exists(select 1 from public."EVENT" where id=p_event_id and "hostId"=v_uid) then
    return json_build_object('error','not_found'); end if;
  if coalesce(btrim(p_reason),'')='' then return json_build_object('error','reason_required'); end if;

  -- Wallet-paid backers: credit their wallet instantly + log a refund transaction.
  for rec in select b."userId", b."amountPaid" from public."BOOKINGS" b
             where b."eventId"=p_event_id and b."deletedAt" is null and b."paymentMethod"='wallet' and b."amountPaid">0 loop
    update public."USER" set "walletBalance"="walletBalance"+rec."amountPaid" where id=rec."userId" returning "walletBalance" into v_bal;
    insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
      values(rec."userId",'refund','wallet',rec."amountPaid",v_bal,p_event_id);
  end loop;

  update public."TICKETS" t set status='refunded',"refundedAt"=v_now
    from public."BOOKINGS" b
    where b.id=t."bookingId" and b."eventId"=p_event_id and b."deletedAt" is null and t.status in('active','used');
  update public."BOOKINGS"
    set "refundedAmount"="amountPaid","refundedAt"=v_now,"updatedAt"=v_now
    where "eventId"=p_event_id and "deletedAt" is null;
  update public."EVENT"
    set status='cancelled',"cancelledAt"=v_now,"cancellationReason"=p_reason,"updatedAt"=v_now
    where id=p_event_id;
  return json_build_object('status','ok');
end; $function$;

-- ── expire_overdue_events: same wallet credit for missed-threshold cancellations
CREATE OR REPLACE FUNCTION public.expire_overdue_events()
 RETURNS TABLE(event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_now timestamptz := now(); v_ids uuid[]; rec record; v_bal numeric;
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

  for rec in select b."userId", b."amountPaid", b."eventId" from public."BOOKINGS" b
             where b."eventId"=any(v_ids) and b."deletedAt" is null and b."paymentMethod"='wallet' and b."amountPaid">0 loop
    update public."USER" set "walletBalance"="walletBalance"+rec."amountPaid" where id=rec."userId" returning "walletBalance" into v_bal;
    insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
      values(rec."userId",'refund','wallet',rec."amountPaid",v_bal,rec."eventId");
  end loop;

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
