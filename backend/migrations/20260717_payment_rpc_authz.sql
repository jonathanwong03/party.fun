-- ── Payment RPC authorization ────────────────────────────────────────────────
-- CRITICAL FIX. create_pledge and wallet_topup were SECURITY DEFINER + GRANTed to
-- `authenticated`, and the browser holds a real Supabase JWT (frontend/src/app/supabase.ts,
-- persistSession) with the anon key in the bundle — so any account holder could call
-- PostgREST directly, bypassing Express and every check it performs:
--
--   * create_pledge(..., p_payment_method:='card', p_charged_amount:=NULL)
--       -> the wallet debit is skipped (method<>'wallet') AND the amount check is skipped
--          (charged_amount IS NULL). Nothing verified the PaymentIntent existed, succeeded,
--          or belonged to the caller. Result: free tickets, and an inflated organiser payout
--          (complete_due_events pays on sum(amountPaid - refundedAmount)).
--   * wallet_topup(p_amount:=100000, p_payment_intent_id:='pi_anything')
--       -> validated ONLY p_amount > 0. Free wallet balance, spendable on real events.
--
-- The frontend calls NEITHER rpc (only the Express backend does), so revoking `authenticated`
-- costs nothing but the attack.
--
-- SHAPE — each function is safe on its OWN terms, not because a GRANT stays correct:
--   create_pledge(p_event_id, p_qty, p_idempotency_key)   authenticated, auth.uid()
--       WALLET ONLY. No payment parameters exist to forge; it debits a real balance. Keeps
--       working with no service-role key.
--   create_pledge_card(p_user_id, ...)                    service_role only
--   wallet_topup(p_user_id, p_amount, p_payment_intent_id) service_role only
--       Both take a p_user_id the backend derived from a validated JWT, and both refuse if
--       auth.uid() is non-null (i.e. an end user reached them) — that guard survives a
--       forgotten REVOKE, which matters because a NEW signature defaults to EXECUTE for
--       PUBLIC and this repo has been bitten by that twice.
--
-- The _create_pledge_impl body is otherwise UNCHANGED from 20260716_remove_gst.sql: the
-- per-event FOR UPDATE lock, the idempotent replay, and the null-safe tiering are all intact.
-- Overloads are dropped by OID first because CREATE OR REPLACE never drops other signatures
-- and create_pledge's signature changes here (the lesson of 20260716_remove_gst.sql).

DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('create_pledge', 'create_pledge_card', 'wallet_topup', '_create_pledge_impl')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $do$;

CREATE OR REPLACE FUNCTION public._create_pledge_impl(
  p_user_id uuid, p_event_id uuid, p_qty integer, p_payment_method text,
  p_payment_intent_id text, p_charged_amount numeric, p_idempotency_key text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=p_user_id; v_event record; v_settings record; v_early record; v_greenlit record;
  v_active int; v_early_sold int; v_early_avail int; v_ec int; v_gc int;
  v_booking_id bigint; v_item_id bigint; v_total numeric:=0; v_now timestamptz:=now();
  v_reference text; v_bal numeric; v_qr_token uuid; v_greenlit_now boolean:=false;
  v_hype boolean; v_ticket_price numeric;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  -- NB: public.is_admin() reads auth.uid(), which is NULL when the backend calls this via
  -- service_role — check the PLEDGING user's role directly or the guard silently dies.
  if exists(select 1 from public."USER" where id=v_uid and role='admin') then
    return json_build_object('error','admin_no_purchase');
  end if;
  -- A 'card' pledge must carry proof the backend actually charged Stripe. Previously BOTH
  -- money paths were conditional, so method='card' + charged_amount=NULL skipped the wallet
  -- debit AND the amount check — minting free tickets. This is the line that closes that.
  if p_payment_method='card' and (p_payment_intent_id is null or p_charged_amount is null) then
    return json_build_object('error','payment_proof_required');
  end if;
  if p_payment_method not in ('wallet','card') then return json_build_object('error','bad_payment_method'); end if;

  if p_idempotency_key is not null then
    select id, reference, "amountPaid", "qrToken"
      into v_booking_id, v_reference, v_total, v_qr_token
      from public."BOOKINGS"
      where "idempotencyKey" = p_idempotency_key and "deletedAt" is null
      limit 1;
    if found then
      return json_build_object('status','ok','bookingId',v_booking_id::text,'reference',v_reference,
                               'amount',v_total,'qrToken',v_qr_token::text,'greenlitNow',false,'idempotent',true);
    end if;
  end if;

  select * into v_event from public."EVENT" where id=p_event_id;
  if not found then return json_build_object('error','not_found'); end if;
  -- Per-event lock: serialize concurrent pledges for this event so the count→check→insert
  -- below is atomic and can never oversell past maxCapacity.
  perform 1 from public."EVENT_SETTINGS" where "eventId"=p_event_id for update;
  if v_event.status='cancelled' then return json_build_object('error','event_cancelled'); end if;
  if v_event."hostId"=v_uid then return json_build_object('error','own_event'); end if;
  if v_event."restrictedUniversity" is not null
     and (select university from public."USER" where id=v_uid) is distinct from v_event."restrictedUniversity" then
    return json_build_object('error','university_restricted');
  end if;
  if exists(select 1 from public."BOOKINGS" b join public."TICKETS" t on t."bookingId"=b.id
      where b."userId"=v_uid and b."eventId"=p_event_id and b."deletedAt" is null and t.status in('active','used'))
  then return json_build_object('error','active_booking_exists'); end if;
  select * into v_settings from public."EVENT_SETTINGS" where "eventId"=p_event_id;
  select * into v_early    from public."PRICE_STATUSES" where "eventId"=p_event_id and "statusName"='early_bird';
  select * into v_greenlit from public."PRICE_STATUSES" where "eventId"=p_event_id and "statusName"='greenlit';
  select count(*)::int into v_active from public."TICKETS" t join public."BOOKINGS" b on b.id=t."bookingId"
    where b."eventId"=p_event_id and t.status in('active','used') and b."deletedAt" is null;
  if v_active+p_qty > v_settings."maxCapacity" then return json_build_object('error','not_enough_tickets'); end if;

  v_hype := coalesce(v_settings."hypeDrivenPricing", false);

  if v_hype then
    if v_settings."basePrice" is null or v_settings."maxPrice" is null
       or v_settings."basePrice" <= 0 or v_settings."maxPrice" <= 0
       or v_settings."basePrice" >= v_settings."maxPrice" then
      return json_build_object('error','invalid_hype_pricing');
    end if;
    for k in 0..(p_qty-1) loop
      v_ticket_price := public.hype_ticket_price(v_settings."basePrice", v_settings."maxPrice", v_settings."maxCapacity", v_active+k);
      if v_ticket_price is null then return json_build_object('error','invalid_hype_pricing'); end if;
      v_total := v_total + v_ticket_price;
    end loop;
  else
    select count(*)::int into v_early_sold from public."TICKETS" t
      join public."BOOKING_ITEMS" bi on bi.id=t."bookingItemId" join public."BOOKINGS" b on b.id=t."bookingId"
      where bi."priceStatusId"=v_early.id and t.status in('active','used') and b."deletedAt" is null;
    v_early_avail:=greatest(0,v_early."ticketCapacity"-v_early_sold);
    v_ec:=least(v_early_avail,p_qty); v_gc:=p_qty-v_ec;
    -- Only price a tier that is actually used: an unused tier contributes exactly 0 rather
    -- than 0 * NULL (= NULL in Postgres), which used to poison v_total.
    v_total := (case when v_ec > 0 then v_ec*v_early.price else 0 end)
             + (case when v_gc > 0 then v_gc*v_greenlit.price else 0 end);
    -- A USED tier with no price is a misconfigured event — fail cleanly.
    if v_total is null then return json_build_object('error','invalid_pricing'); end if;
  end if;

  -- Prices are GST-inclusive, so the client's total and v_total are directly comparable.
  if p_payment_method='card' and abs(v_total - p_charged_amount) > 0.015 then
    return json_build_object('error','price_mismatch');
  end if;

  -- Wallet pays the ticket total (GST-inclusive; no separate GST line).
  if p_payment_method = 'wallet' then
    update public."USER" set "walletBalance" = "walletBalance" - v_total
      where id = v_uid and "walletBalance" >= v_total;
    if not found then return json_build_object('error','insufficient_funds'); end if;
  end if;
  v_reference:='PF-'||upper(substr(p_event_id::text,1,4))||'-'||lpad((floor(random()*9000)+1000)::int::text,4,'0');
  insert into public."BOOKINGS"("userId","eventId","amountPaid","refundedAmount",status,reference,"paymentMethod","stripePaymentIntentId","idempotencyKey","stripeChargeAt","capturedAt","createdAt","updatedAt")
  values(v_uid,p_event_id,0,0,'captured',v_reference,p_payment_method,p_payment_intent_id,p_idempotency_key,
         case when p_payment_method='card' then v_now else null end,v_now,v_now,v_now)
  returning id, "qrToken" into v_booking_id, v_qr_token;

  if v_hype then
    for k in 0..(p_qty-1) loop
      v_ticket_price := public.hype_ticket_price(v_settings."basePrice", v_settings."maxPrice", v_settings."maxCapacity", v_active+k);
      insert into public."BOOKING_ITEMS"("bookingId","priceStatusId",quantity,"unitPrice",subtotal,"createdAt")
      values(v_booking_id,v_early.id,1,v_ticket_price,v_ticket_price,v_now) returning id into v_item_id;
      insert into public."TICKETS"("bookingId","bookingItemId","qrCode",status,"createdAt")
      values(v_booking_id,v_item_id,'PF-'||gen_random_uuid()::text,'active',v_now);
    end loop;
  else
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
  end if;

  update public."BOOKINGS" set "amountPaid"=v_total,"updatedAt"=v_now where id=v_booking_id;
  if p_payment_method = 'wallet' then
    select "walletBalance" into v_bal from public."USER" where id=v_uid;
    insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","eventId")
      values(v_uid,'pledge','wallet',v_total,v_bal,p_event_id);
  end if;
  if v_event.status='early_bird' and (v_active+p_qty) >= v_settings."hypeThreshold" then
    update public."EVENT" set status='greenlit',"updatedAt"=v_now where id=p_event_id and status='early_bird';
    if found then v_greenlit_now := true; end if;
  end if;
  return json_build_object('status','ok','bookingId',v_booking_id::text,'reference',v_reference,'amount',v_total,
                           'qrToken',v_qr_token::text,'greenlitNow',v_greenlit_now);
end; $function$;
-- Internal only: reachable solely through the SECURITY DEFINER wrappers below (which run as
-- the owner). Never grant this to anyone — it trusts p_user_id completely.
REVOKE ALL ON FUNCTION public._create_pledge_impl(uuid, uuid, integer, text, text, numeric, text) FROM PUBLIC, anon, authenticated;

-- Wallet pledge: the only pledge path an end user may call directly. There is nothing to
-- forge — no payment parameters exist, and the debit comes out of a real balance.
CREATE OR REPLACE FUNCTION public.create_pledge(
  p_event_id uuid, p_qty integer, p_idempotency_key text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  return public._create_pledge_impl(v_uid, p_event_id, p_qty, 'wallet', null, null, p_idempotency_key);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pledge(uuid, integer, text) TO authenticated;

-- Card pledge: service_role ONLY. The backend charges Stripe, verifies the PaymentIntent
-- succeeded and matches the amount, and only then calls this with the JWT-validated user id.
CREATE OR REPLACE FUNCTION public.create_pledge_card(
  p_user_id uuid, p_event_id uuid, p_qty integer,
  p_payment_intent_id text, p_charged_amount numeric, p_idempotency_key text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  -- Defence in depth: a real end-user JWT always carries a uid; service_role never does.
  -- Survives a forgotten REVOKE on this or any future signature.
  if auth.uid() is not null then return json_build_object('error','forbidden'); end if;
  if p_user_id is null then return json_build_object('error','not_authenticated'); end if;
  return public._create_pledge_impl(p_user_id, p_event_id, p_qty, 'card',
                                    p_payment_intent_id, p_charged_amount, p_idempotency_key);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.create_pledge_card(uuid, uuid, integer, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pledge_card(uuid, uuid, integer, text, numeric, text) TO service_role;

-- Wallet top-up: service_role ONLY. No safe authenticated version can exist — Postgres cannot
-- verify a Stripe charge, so any user-callable top-up mints money. The backend creates the
-- PaymentIntent, asserts status='succeeded' AND the amount matches, then calls this.
-- wallet_txn_stripe_pi_uniq still blocks replaying the same PaymentIntent.
CREATE OR REPLACE FUNCTION public.wallet_topup(
  p_user_id uuid, p_amount numeric, p_payment_intent_id text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_bal numeric;
begin
  if auth.uid() is not null then return json_build_object('error','forbidden'); end if;
  if p_user_id is null then return json_build_object('error','not_authenticated'); end if;
  if p_amount is null or p_amount <= 0 then return json_build_object('error','bad_amount'); end if;
  if p_payment_intent_id is null or btrim(p_payment_intent_id) = '' then
    return json_build_object('error','payment_proof_required');
  end if;
  update public."USER" set "walletBalance" = "walletBalance" + p_amount where id = p_user_id returning "walletBalance" into v_bal;
  if not found then return json_build_object('error','not_found'); end if;
  insert into public."WALLET_TRANSACTIONS"("userId",type,source,amount,"balanceAfter","stripePaymentIntentId")
    values(p_user_id,'topup','card',p_amount,v_bal,p_payment_intent_id);
  return json_build_object('status','ok','balance',v_bal);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.wallet_topup(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_topup(uuid, numeric, text) TO service_role;
