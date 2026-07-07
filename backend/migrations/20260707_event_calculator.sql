-- Profit calculator state, one row per event. Replaces the old revenue-prediction
-- forecast: organisers store an editable set of ticket prices/quantities and
-- operational-cost line items, and the app computes profit = revenue - cost.
-- Run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public."EVENT_CALCULATOR" (
  "eventId"   uuid PRIMARY KEY REFERENCES public."EVENT"(id) ON DELETE CASCADE,
  state       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."EVENT_CALCULATOR" ENABLE ROW LEVEL SECURITY;

-- Only the event owner / accepted co-organisers may read or write the calculator,
-- reusing the same ownership check as update_event et al.
DROP POLICY IF EXISTS event_calculator_select ON public."EVENT_CALCULATOR";
CREATE POLICY event_calculator_select ON public."EVENT_CALCULATOR"
  FOR SELECT TO authenticated
  USING (public.can_manage_event("eventId", auth.uid()));

DROP POLICY IF EXISTS event_calculator_insert ON public."EVENT_CALCULATOR";
CREATE POLICY event_calculator_insert ON public."EVENT_CALCULATOR"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_event("eventId", auth.uid()));

DROP POLICY IF EXISTS event_calculator_update ON public."EVENT_CALCULATOR";
CREATE POLICY event_calculator_update ON public."EVENT_CALCULATOR"
  FOR UPDATE TO authenticated
  USING (public.can_manage_event("eventId", auth.uid()))
  WITH CHECK (public.can_manage_event("eventId", auth.uid()));

DROP POLICY IF EXISTS event_calculator_delete ON public."EVENT_CALCULATOR";
CREATE POLICY event_calculator_delete ON public."EVENT_CALCULATOR"
  FOR DELETE TO authenticated
  USING (public.can_manage_event("eventId", auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public."EVENT_CALCULATOR" TO authenticated;
