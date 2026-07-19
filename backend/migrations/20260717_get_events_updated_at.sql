-- ── Expose EVENT.updatedAt in get_events ─────────────────────────────────────
-- The edit form needs the row's updatedAt to send back as the optimistic-concurrency base version
-- (see 20260717_update_event_concurrency.sql). Add one field to the projection; body otherwise
-- UNCHANGED from 20260716_event_coordinates.sql. Signature is unchanged, so CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.get_events()
 RETURNS SETOF json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id', e.id, 'hostId', e."hostId", 'title', coalesce(e.title, ''),
    'description', coalesce(e.description, ''), 'location', coalesce(e.location, ''),
    'address', coalesce(e.address, ''),
    'latitude', e.latitude, 'longitude', e.longitude,
    'imageUrl', coalesce(e."imageUrl", ''), 'startDate', e."startDate", 'endDate', e."endDate",
    'updatedAt', e."updatedAt",
    'deadlineAt', es.deadline, 'hypeThreshold', es."hypeThreshold", 'maxCapacity', es."maxCapacity",
    'hypeDrivenPricing', coalesce(es."hypeDrivenPricing", false),
    'basePrice', es."basePrice",
    'maxPrice', es."maxPrice",
    'costs', json_build_object('venue',es."costVenue",'fnb',es."costFnb",'av',es."costAv",'talent',es."costTalent",'marketing',es."costMarketing",'staffing',es."costStaffing",'decor',es."costDecor"),
    'current_dynamic_price', CASE
      WHEN coalesce(es."hypeDrivenPricing", false) THEN
        public.hype_ticket_price(es."basePrice", es."maxPrice", es."maxCapacity",
          (SELECT count(*)::int FROM public."TICKETS" t JOIN public."BOOKINGS" b ON b.id = t."bookingId"
            WHERE b."eventId" = e.id AND t.status IN ('active','used') AND b."deletedAt" IS NULL))
      ELSE NULL END,
    'organiser_name', coalesce(u.name, u.username, ''), 'host_university', coalesce(u.university, ''),
    'restricted_university', coalesce(e."restrictedUniversity", ''),
    'viewer_can_attend', (
      e."restrictedUniversity" IS NULL
      OR (SELECT auth.uid()) IS NULL
      OR e."restrictedUniversity" = coalesce((SELECT university FROM public."USER" WHERE id = (SELECT auth.uid())), '')
    ),
    'hostHidden', e."hostHidden",
    'isCoOrganiser', public.is_event_coorganiser(e.id, (select auth.uid())),
    'canEdit', public.can_manage_event(e.id, (select auth.uid())),
    'canCheckIn', public.can_manage_event(e.id, (select auth.uid())),
    'canViewAttendees', public.can_manage_event(e.id, (select auth.uid())),
    'canCancel', public.is_event_owner(e.id, (select auth.uid())) OR public.is_admin(),
    'canDelete', public.is_event_owner(e.id, (select auth.uid())) OR public.is_admin(),
    'derived_status', CASE
      WHEN e.status = 'cancelled' THEN 'cancelled'
      WHEN e.status = 'completed' THEN 'completed'
      WHEN e.status = 'greenlit' THEN 'greenlit'
      WHEN e."endDate" < now() THEN 'completed'
      WHEN (SELECT count(*) FROM public."TICKETS" t JOIN public."BOOKINGS" b ON b.id = t."bookingId"
            WHERE b."eventId" = e.id AND t.status IN ('active','used') AND b."deletedAt" IS NULL) >= es."hypeThreshold" THEN 'greenlit'
      ELSE 'early_bird' END,
    'active_ticket_count', (SELECT count(*)::int FROM public."TICKETS" t JOIN public."BOOKINGS" b ON b.id = t."bookingId"
      WHERE b."eventId" = e.id AND t.status IN ('active','used') AND b."deletedAt" IS NULL),
    'statuses', (SELECT json_agg(json_build_object(
        'statusName', ps."statusName", 'price', ps.price, 'ticketCapacity', ps."ticketCapacity",
        'sold', (SELECT count(*)::int FROM public."TICKETS" t2 JOIN public."BOOKING_ITEMS" bi ON bi.id = t2."bookingItemId"
                 JOIN public."BOOKINGS" b2 ON b2.id = t2."bookingId"
                 WHERE bi."priceStatusId" = ps.id AND t2.status IN ('active','used') AND b2."deletedAt" IS NULL)
      ) ORDER BY ps."statusName" ASC) FROM public."PRICE_STATUSES" ps WHERE ps."eventId" = e.id)
  )
  FROM public."EVENT" e
  JOIN public."USER" u ON u.id = e."hostId"
  JOIN public."EVENT_SETTINGS" es ON es."eventId" = e.id
  ORDER BY e."createdAt" DESC;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_events() TO anon, authenticated;
