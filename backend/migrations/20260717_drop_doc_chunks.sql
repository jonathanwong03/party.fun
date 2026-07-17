-- ── Retire the app-knowledge RAG copy ────────────────────────────────────────
-- app-knowledge.md is now the SINGLE source of truth: it is read live at module init and
-- grounded on directly by the graph agent's system prompt, the get_app_info tool, and
-- answerAppQuestion. The DOC_CHUNKS table was a second, separately-refreshed copy of the same
-- doc (chunked + embedded by scripts/backfillEmbeddings.js) that could drift out of sync — the
-- source of the ambiguity. Nothing reads it anymore (retrieveKnowledge + backfillDocs were
-- removed), so drop it and its retrieval RPC.
--
-- OPTIONAL / independent: the code no longer references either object, so leaving them in place
-- is harmless. This migration is pure cleanup. EVENT_EMBEDDINGS (semantic EVENT search) is a
-- different table and is deliberately untouched.

DROP FUNCTION IF EXISTS public.match_doc_chunks(text, int);
DROP TABLE IF EXISTS public."DOC_CHUNKS";
