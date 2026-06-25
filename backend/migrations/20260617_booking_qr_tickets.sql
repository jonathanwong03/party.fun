-- Migration: booking-level QR tickets + time-windowed check-in.
--   * BOOKINGS.qrToken: the booking-level QR payload (one scan checks in all remaining).
--   * check_in_booking(token): host-scoped; only valid during the event window; flips
--     all the booking's `active` tickets to `used`. Cancelled/given-away are untouched.
--   * check_in_ticket(qr): per-ticket check-in, now also window-guarded + distinct given_away.
--   * create_pledge: returns qrToken + greenlitNow (additive) so the backend can email
--     the booking ticket and fan out greenlit ticket emails.

ALTER TABLE public."BOOKINGS" ADD COLUMN IF NOT EXISTS "qrToken" uuid NOT NULL DEFAULT gen_random_uuid();

CREATE OR REPLACE FUNCTION public.check_in_booking(p_token text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_bid bigint; v_title text; v_attendee text;
  v_start timestamptz; v_end timestamptz; v_now timestamptz := now(); v_active int; v_total int; v_used int;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select b.id, e.title, u.username, e."startDate", e."endDate"
    into v_bid, v_title, v_attendee, v_start, v_end
  from public."BOOKINGS" b
  join public."EVENT" e on e.id=b."eventId"
  join public."USER" u on u.id=b."userId"
  where b."qrToken"::text = btrim(p_token) and e."hostId" = v_uid and b."deletedAt" is null;
  if not found then return json_build_object('error','not_found'); end if;
  if v_now < v_start then return json_build_object('error','too_early','eventTitle',v_title); end if;
  if v_now > v_end then return json_build_object('error','too_late','eventTitle',v_title); end if;
  select count(*) filter (where status='active'), count(*) filter (where status in ('active','used')), count(*) filter (where status='used')
    into v_active, v_total, v_used from public."TICKETS" where "bookingId"=v_bid;
  if v_active = 0 then
    return json_build_object('error', case when v_used>0 then 'already_used' else 'nothing_to_check_in' end,
                             'attendee',v_attendee,'eventTitle',v_title);
  end if;
  update public."TICKETS" set status='used' where "bookingId"=v_bid and status='active';
  return json_build_object('status','ok','checkedIn',v_active,'total',v_total,'attendee',v_attendee,'eventTitle',v_title);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.check_in_booking(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_booking(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in_ticket(p_qr text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_id bigint; v_status text; v_title text; v_attendee text;
  v_start timestamptz; v_end timestamptz; v_now timestamptz := now();
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  select t.id, t.status, e.title, u.username, e."startDate", e."endDate"
    into v_id, v_status, v_title, v_attendee, v_start, v_end
  from public."TICKETS" t
  join public."BOOKINGS" b on b.id=t."bookingId"
  join public."EVENT" e on e.id=b."eventId"
  join public."USER" u on u.id=b."userId"
  where t."qrCode"=btrim(p_qr) and e."hostId"=v_uid;
  if not found then return json_build_object('error','not_found'); end if;
  if v_status = 'used' then return json_build_object('error','already_used','attendee',v_attendee,'eventTitle',v_title); end if;
  if v_status = 'given_away' then return json_build_object('error','given_away'); end if;
  if v_status <> 'active' then return json_build_object('error','refunded'); end if;
  if v_now < v_start then return json_build_object('error','too_early','eventTitle',v_title); end if;
  if v_now > v_end then return json_build_object('error','too_late','eventTitle',v_title); end if;
  update public."TICKETS" set status='used' where id=v_id;
  return json_build_object('status','ok','checkedIn',1,'attendee',v_attendee,'eventTitle',v_title);
end; $function$;
REVOKE EXECUTE ON FUNCTION public.check_in_ticket(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_ticket(text) TO authenticated;

-- create_pledge now also returns 'qrToken' and 'greenlitNow' (see full body in the app DB).
-- Only the booking INSERT (returning qrToken), a v_greenlit_now flag set after the
-- early_bird→greenlit UPDATE, and the final json_build_object changed.
