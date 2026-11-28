/* 2026-11-28 DataTable."publicEpoch", the generation of a table's public
   link (pen test 2026-11-28, V-30).

   WHAT THIS FILE DOES, guarded, so a deploy that finds it in place changes
   nothing:
   1. The column "publicEpoch" (integer, may be empty), if missing.
   Nothing is deleted and no row is written: every table keeps an empty
   generation, which is how a table made public before this file keeps its
   current link working until its link is turned off or reset.

   WHY. A table's public link was its bare internal id, the same id in every
   internal URL, notification and copied link, so turning the link on exposed
   the table to everyone who ever had an internal link, and off then on
   brought the same URL back. The link now carries a signature of the table
   and this generation (src/lib/tables/public-link.ts), which goes up each
   time the link is turned on or reset, so an old link stops working. The
   generation is not a secret; the signature needs the server's key. */

ALTER TABLE "DataTable" ADD COLUMN IF NOT EXISTS "publicEpoch" INTEGER;
