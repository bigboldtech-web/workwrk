-- Phase D5: Autopilot AUTOMATION workflows use COMPLETED/FAILED
-- terminal states. Additive enum extension; existing rows unaffected.

ALTER TYPE "WorkflowRunStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "WorkflowRunStatus" ADD VALUE IF NOT EXISTS 'FAILED';
