-- 2026-09-19 · spaces-lists phase 2 · Trash can say who archived something.
--
-- Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, /trash:
-- "Archived tab: the same columns with 'Archived by' and 'Archived'".
--
-- THE BUG THIS CLOSES. The Archived tab printed a column headed "Archived by"
-- and filled it with the object's OWNER, plus that person's avatar, because no
-- column recorded the archiver. A Space owned by Alice and archived by Bob
-- read "Archived by Alice": a fabricated attribution on the one page whose
-- whole job is telling you who removed something.
--
-- Six nullable columns, one per table that carries archivedAt and appears on
-- the Archived tab. Nullable on purpose and forever: every row archived before
-- today has no recorded archiver, and the page renders those as a blank cell
-- rather than guessing. No rename, no retype, no drop, no new required column.
--
-- Readers tolerate the columns being absent for one release: src/lib/
-- trash-server.ts selects them inside a try/catch that falls back to the same
-- "unknown archiver" blank the null case produces.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op on a second run.

ALTER TABLE "Space" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;
ALTER TABLE "Folder" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;
ALTER TABLE "Board" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;
ALTER TABLE "Doc" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;
ALTER TABLE "Whiteboard" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;
