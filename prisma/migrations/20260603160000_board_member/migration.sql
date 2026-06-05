-- 2026-06-03 — Phase 23: Per-Board access overrides.
--   Adds BoardMember table mirroring SpaceMember. When Board.visibility
--   = PRIVATE the resolver gates on BoardMember + Space OWNER + admin.
-- Additive-only. No existing rows touched.

CREATE TABLE "BoardMember" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SpaceRole" NOT NULL DEFAULT 'MEMBER',
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BoardMember_boardId_userId_key"
    ON "BoardMember"("boardId", "userId");

CREATE INDEX "BoardMember_userId_idx" ON "BoardMember"("userId");
CREATE INDEX "BoardMember_boardId_role_idx" ON "BoardMember"("boardId", "role");

ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_boardId_fkey"
    FOREIGN KEY ("boardId") REFERENCES "Board"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
