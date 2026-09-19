-- 2026-09-19 · spaces-lists phase 2 · a Canvas can live on a Folder.
--
-- Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, /folders/[id]:
-- "Canvases are here because the Folder's own New submenu creates them and the
-- tree anchors them under Folders: a Canvas made from this page must have a row
-- on this page, not only in the sidebar."
--
-- WHY IT IS NEEDED. `Whiteboard` carries `spaceId` and nothing else, so the
-- Folder menu's "Canvas" row created the object in the SPACE and the Folder
-- page (which listed no canvases at all) never showed it. The thing a person
-- made was not on the page they made it from.
--
-- Additive and idempotent: one nullable column and one index. Every existing
-- row keeps NULL, which reads as "anchored to the Space, as before", and every
-- reader treats the column as optional, so this file may be applied before or
-- after the release that uses it.

ALTER TABLE "Whiteboard" ADD COLUMN IF NOT EXISTS "folderId" TEXT;

CREATE INDEX IF NOT EXISTS "Whiteboard_folderId_idx" ON "Whiteboard" ("folderId");
