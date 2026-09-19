-- Template.key: the stable seed key the built-in template seed upserts on.
--
-- Additive and idempotent. Nullable, so every template an org saved keeps a
-- null and is untouched; Postgres does not treat nulls as equal, so the unique
-- index below constrains only the seeded rows.
--
-- Apply in production with:
--   npx prisma db execute --file prisma/sql/2026-09-19-template-key.sql
-- (see prisma/sql/README.md)

ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Template_key_key" ON "Template" ("key");
