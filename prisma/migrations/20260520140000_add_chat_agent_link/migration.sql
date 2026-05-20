-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "agentId" TEXT;

-- CreateIndex
CREATE INDEX "ChatSession_agentId_idx" ON "ChatSession"("agentId");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
