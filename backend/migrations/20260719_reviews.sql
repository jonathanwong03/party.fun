-- ── Per-event reviews ────────────────────────────────────────────────────────
-- Attendees rate a COMPLETED event (1-5 stars + optional text). Reviews are shown
-- on the in-app Review page. Eligibility (event finished + the caller actually
-- joined it) is enforced in submit_review, not by RLS, so the write goes through a
-- SECURITY DEFINER RPC while reads are a simple authenticated SELECT.

create table if not exists public."REVIEWS" (
  id          bigint generated always as identity primary key,
  "userId"    uuid not null default auth.uid() references public."USER"(id) on delete cascade,
  "eventId"   uuid not null references public."EVENT"(id) on delete cascade,
  rating      int  not null check (rating between 1 and 5),
  body        text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("userId", "eventId")   -- one review per user per event (re-submit edits it)
);
create index if not exists reviews_event_idx on public."REVIEWS" ("eventId");
create index if not exists reviews_created_idx on public."REVIEWS" ("createdAt" desc);

alter table public."REVIEWS" enable row level security;
-- In-app reviews are visible to any signed-in user (the Review page wall).
drop policy if exists reviews_authenticated_read on public."REVIEWS";
create policy reviews_authenticated_read on public."REVIEWS" for select to authenticated using (true);
-- No INSERT/UPDATE policy: writes only ever happen through submit_review (SECURITY DEFINER).

revoke all on public."REVIEWS" from public, anon;
grant select on public."REVIEWS" to authenticated;

-- ── submit_review: eligibility-checked upsert ────────────────────────────────
create or replace function public.submit_review(p_event_id uuid, p_rating int, p_body text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_status text;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then return json_build_object('error','bad_rating'); end if;
  select status into v_status from public."EVENT" where id = p_event_id;
  if v_status is null then return json_build_object('error','not_found'); end if;
  if v_status <> 'completed' then return json_build_object('error','event_not_completed'); end if;
  -- Must have actually joined the event (a live booking) to review it.
  if not exists (
    select 1 from public."BOOKINGS" b
    where b."eventId" = p_event_id and b."userId" = v_uid and b."deletedAt" is null
  ) then
    return json_build_object('error','not_attended');
  end if;
  insert into public."REVIEWS" ("userId", "eventId", rating, body)
  values (v_uid, p_event_id, p_rating, nullif(btrim(coalesce(p_body,'')), ''))
  on conflict ("userId", "eventId") do update
    set rating = excluded.rating, body = excluded.body, "updatedAt" = now();
  return json_build_object('status','ok');
end; $function$;
revoke execute on function public.submit_review(uuid, int, text) from public, anon;
grant execute on function public.submit_review(uuid, int, text) to authenticated;

-- ── get_reviews: the collated wall (all reviews + event title + author) ───────
create or replace function public.get_reviews()
 returns json language sql security definer set search_path to 'public' stable
as $function$
  select coalesce(json_agg(json_build_object(
    'id', r.id,
    'eventId', r."eventId",
    'eventTitle', e.title,
    'username', u.username,
    'rating', r.rating,
    'body', r.body,
    'createdAt', r."createdAt"
  ) order by r."createdAt" desc), '[]'::json)
  from public."REVIEWS" r
  join public."EVENT" e on e.id = r."eventId"
  join public."USER"  u on u.id = r."userId";
$function$;
revoke execute on function public.get_reviews() from public, anon;
grant execute on function public.get_reviews() to authenticated;

-- ── get_my_reviewable_events: completed events the caller joined but hasn't reviewed ──
create or replace function public.get_my_reviewable_events()
 returns json language sql security definer set search_path to 'public' stable
as $function$
  select coalesce(json_agg(json_build_object(
    'id', e.id,
    'title', e.title,
    'startDate', e."startDate",
    'endDate', e."endDate",
    'imageUrl', e."imageUrl"
  ) order by e."endDate" desc), '[]'::json)
  from public."EVENT" e
  where e.status = 'completed'
    and exists (
      select 1 from public."BOOKINGS" b
      where b."eventId" = e.id and b."userId" = auth.uid() and b."deletedAt" is null
    )
    and not exists (
      select 1 from public."REVIEWS" r
      where r."eventId" = e.id and r."userId" = auth.uid()
    );
$function$;
revoke execute on function public.get_my_reviewable_events() from public, anon;
grant execute on function public.get_my_reviewable_events() to authenticated;
