/* 2026-10-22 Ended sessions: a plain log out ends only that browser's session
   (src/lib/auth/ended-sessions.ts). One new table, "EndedSession": the
   session id of a token logged out in one browser, the account, when, and
   when the row may go. The jwt revalidation reads it by primary key and ends
   a listed token, with every copy of its cookie; the person's other devices
   stay signed in. No key to "User", so no lock on it, ever. Additive and
   idempotent; the index is catalogue-guarded. EXISTING ROWS ARE UNCHANGED.
   NO BACKFILL. Before the reload: the new build writes a row on a plain log
   out and falls back to the old tokenVersion bump while the table is absent,
   and a failed read of it never ends a session. Rollback: DROP TABLE IF
   EXISTS "EndedSession"; */

CREATE TABLE IF NOT EXISTS "EndedSession" (
  "sid"       TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "endedAt"   TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EndedSession_pkey" PRIMARY KEY ("sid")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'EndedSession_expiresAt_idx') THEN
    CREATE INDEX "EndedSession_expiresAt_idx" ON "EndedSession" ("expiresAt");
  END IF;
END
$$;
