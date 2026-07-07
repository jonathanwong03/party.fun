-- The revenue-prediction model (attractiveness scoring, transit accessibility,
-- weather multiplier, regression weights, kNN Bayesian calibration) has been removed
-- in favour of a simple editable profit calculator. EVENT_SALES_SNAPSHOTS existed only
-- to feed that model's historical calibration and is now unused. Run in the SQL editor.
--
-- NOTE: the semantic vector RPC match_similar_past_events and the event embeddings are
-- NOT dropped — they still power the get_similar_past_events assistant tool and search.

DROP TABLE IF EXISTS public."EVENT_SALES_SNAPSHOTS" CASCADE;
