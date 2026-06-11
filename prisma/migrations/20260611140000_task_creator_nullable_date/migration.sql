-- Make due date optional (supports "Unscheduled" tasks)
ALTER TABLE "Task" ALTER COLUMN "date" DROP NOT NULL;

-- Track who created/delegated the task
ALTER TABLE "Task" ADD COLUMN "createdById" TEXT;

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");
