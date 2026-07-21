-- Reviews power the landing-page "What students say" carousel (replacing the old hardcoded
-- fictional testimonials), so get_reviews changes in three ways:
--
--   1. Projects the author's "avatarUrl" and university — the carousel shows a profile picture
--      and school alongside each quote.
--   2. LIMITED TO THE 20 MOST RECENT. The carousel is the only consumer; if a full reviews wall
--      is ever reintroduced, add a separate function rather than lifting this limit silently.
--   3. Executable by anon. The carousel lives on /events, which guests can browse, and reviews
--      are public social proof (username + rating + text — nothing private). Writing a review
--      still requires auth via submit_review, which is untouched.
--
-- Signature is unchanged (no arguments), so CREATE OR REPLACE cannot leave a stale overload.

create or replace function public.get_reviews()
 returns json language sql security definer set search_path to 'public' stable
as $function$
  -- json_agg cannot be LIMITed directly, so the limit is applied in a subquery and the
  -- ordering restated on the aggregate to keep newest-first after aggregation.
  select coalesce(json_agg(row_to_json(t) order by t."createdAt" desc), '[]'::json)
  from (
    select r.id,
           r."eventId",
           e.title        as "eventTitle",
           u.username,
           u."avatarUrl",
           u.university,
           r.rating,
           r.body,
           r."createdAt"
    from public."REVIEWS" r
    join public."EVENT" e on e.id = r."eventId"
    join public."USER"  u on u.id = r."userId"
    order by r."createdAt" desc
    limit 20
  ) t;
$function$;

-- PUBLIC is revoked first so the grant below is the only source of access (revoking from
-- PUBLIC alone would also strip anon/authenticated, hence the explicit re-grant).
revoke execute on function public.get_reviews() from public;
grant execute on function public.get_reviews() to anon, authenticated;
