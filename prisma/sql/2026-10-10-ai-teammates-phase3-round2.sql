-- AI teammates, Phase 3, review round 2 of the whole phase
-- (docs/plans/ai-teammates-phase3.md, "After Phase 3").
--
-- Since review round 1, a turn told of a card reads the run that made it as
-- clean only when that run recorded "output"."readGoogle" = false
-- (src/lib/agents/engine.ts runsTaint). A run that ended before round 1
-- recorded readGoogle only when it was true, so every such run reads as
-- unknown: the turn told of its card asks before every write and ignores the
-- person's "Don't ask", in every workspace, Google or not, until the backlog
-- of untold outcomes is told, a few a turn.
--
-- This records readGoogle = false on exactly those runs:
--   - their final write is on record ("output" ? 'toolCalls'): a run the
--     stale-run sweep closed has none, and stays unknown;
--   - readGoogle is not recorded at all (guarded on its own effect, so a
--     second run changes nothing, and a run marked true is never touched);
--   - their output names none of the tools that read the person's Google
--     (search_email, read_email, list_events, and the writes whose
--     preparation reads it: reply_email, update_event, cancel_event,
--     respond_to_invite), as a call or anywhere in the answer;
--   - a card of theirs is not yet told ("AgentAction"."reportedAt" IS NULL),
--     the only runs anything still reads this for, which keeps it small.
-- jsonb_set only adds the key: nothing else in "output" changes.
--
-- Additive and idempotent. No column, no index, no constraint; a plain
-- UPDATE whose WHERE excludes every row it already wrote.
-- Rollback: none needed. The build before this one reads readGoogle false
-- as clean too, and a run without the key only reads as unknown, which asks
-- before every write, the safe side.

UPDATE "AgentRun"
   SET "output" = jsonb_set("output", '{readGoogle}', 'false'::jsonb, true)
 WHERE jsonb_typeof("output") = 'object'
   AND "output" ? 'toolCalls'
   AND NOT ("output" ? 'readGoogle')
   AND "output"::text NOT LIKE '%search_email%'
   AND "output"::text NOT LIKE '%read_email%'
   AND "output"::text NOT LIKE '%list_events%'
   AND "output"::text NOT LIKE '%reply_email%'
   AND "output"::text NOT LIKE '%update_event%'
   AND "output"::text NOT LIKE '%cancel_event%'
   AND "output"::text NOT LIKE '%respond_to_invite%'
   AND "id" IN (SELECT DISTINCT "runId" FROM "AgentAction" WHERE "reportedAt" IS NULL AND "runId" IS NOT NULL);
