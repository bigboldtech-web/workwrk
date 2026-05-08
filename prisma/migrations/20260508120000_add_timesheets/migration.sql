-- Phase 2: Time tracking. Weekly timesheet envelope plus per-entry
-- rows that carry either manual hours or clock-in/out timestamps.
-- Hot index on (userId, clockedOutAt) supports the "is this user
-- currently clocked in?" check on every page load.

CREATE TYPE "TimesheetStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE "TimeEntrySource" AS ENUM (
  'WEB',
  'PUNCH',
  'MOBILE',
  'KIOSK',
  'IMPORT'
);

CREATE TABLE "Timesheet" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "weekStartDate"  TIMESTAMP(3) NOT NULL,
  "status"         "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt"    TIMESTAMP(3),
  "approverId"     TEXT,
  "decisionAt"     TIMESTAMP(3),
  "decisionNote"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Timesheet_userId_weekStartDate_key"
  ON "Timesheet"("userId", "weekStartDate");
CREATE INDEX "Timesheet_organizationId_status_idx"
  ON "Timesheet"("organizationId", "status");
CREATE INDEX "Timesheet_userId_weekStartDate_idx"
  ON "Timesheet"("userId", "weekStartDate");
CREATE INDEX "Timesheet_approverId_status_idx"
  ON "Timesheet"("approverId", "status");

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_approverId_fkey"
  FOREIGN KEY ("approverId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TimeEntry" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "timesheetId"    TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "day"            TIMESTAMP(3) NOT NULL,
  "hours"          DECIMAL(5,2),
  "clockedInAt"    TIMESTAMP(3),
  "clockedOutAt"   TIMESTAMP(3),
  "description"    TEXT,
  "source"         "TimeEntrySource" NOT NULL DEFAULT 'WEB',
  "taskId"         TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimeEntry_organizationId_day_idx"
  ON "TimeEntry"("organizationId", "day");
CREATE INDEX "TimeEntry_userId_day_idx"
  ON "TimeEntry"("userId", "day");
CREATE INDEX "TimeEntry_timesheetId_idx"
  ON "TimeEntry"("timesheetId");
CREATE INDEX "TimeEntry_userId_clockedOutAt_idx"
  ON "TimeEntry"("userId", "clockedOutAt");
CREATE INDEX "TimeEntry_taskId_idx"
  ON "TimeEntry"("taskId");

ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_timesheetId_fkey"
  FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
