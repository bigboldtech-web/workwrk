-- Session invalidation: a per-user counter baked into the session JWT and
-- bumped on sign-out / password reset, so a stolen or copied token dies at once.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
