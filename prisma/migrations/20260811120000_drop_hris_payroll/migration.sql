-- Drop the HRIS + payroll subsystem. WorkwrK is a work-management system;
-- recruiting/ATS, learning/LMS, onboarding, leave, payroll, benefits,
-- compensation, headcount planning and expenses are out of scope and their
-- surfaces were removed in the preceding commit.
--
-- A JSON backup of every row in these tables was taken first:
--   /root/workwrk-backups/hris-payroll-backup-*.json  (production held 1 row)
--
-- Children are dropped before parents so no FK blocks the drop. Nothing
-- outside this list is touched — SOPs, tasks, docs, people, reviews,
-- timesheets, kudos, assets, policies, agreements, talent, candor and
-- surveys all stay exactly as they are.

-- ── children first ───────────────────────────────────────────────────
DROP TABLE IF EXISTS "Interview" CASCADE;
DROP TABLE IF EXISTS "Application" CASCADE;
DROP TABLE IF EXISTS "Candidate" CASCADE;
DROP TABLE IF EXISTS "Job" CASCADE;

DROP TABLE IF EXISTS "CourseEnrollment" CASCADE;
DROP TABLE IF EXISTS "TrainingCourse" CASCADE;

DROP TABLE IF EXISTS "OnboardingInstance" CASCADE;
DROP TABLE IF EXISTS "OnboardingTemplate" CASCADE;

DROP TABLE IF EXISTS "TimeOffRequest" CASCADE;
DROP TABLE IF EXISTS "TimeOffPolicy" CASCADE;

DROP TABLE IF EXISTS "PayslipLine" CASCADE;
DROP TABLE IF EXISTS "Payslip" CASCADE;
DROP TABLE IF EXISTS "PayRun" CASCADE;

DROP TABLE IF EXISTS "BenefitEnrollment" CASCADE;
DROP TABLE IF EXISTS "BenefitTier" CASCADE;
DROP TABLE IF EXISTS "BenefitPlan" CASCADE;

DROP TABLE IF EXISTS "CompensationDecision" CASCADE;
DROP TABLE IF EXISTS "CompensationCycle" CASCADE;
DROP TABLE IF EXISTS "SalaryBand" CASCADE;

DROP TABLE IF EXISTS "HeadcountPlan" CASCADE;
DROP TABLE IF EXISTS "Expense" CASCADE;

-- ── enums owned solely by the above ──────────────────────────────────
DROP TYPE IF EXISTS "InterviewStatus";
DROP TYPE IF EXISTS "InterviewType";
DROP TYPE IF EXISTS "ApplicationStage";
DROP TYPE IF EXISTS "EmploymentType";
DROP TYPE IF EXISTS "JobStatus";
DROP TYPE IF EXISTS "OnboardingStatus";
DROP TYPE IF EXISTS "TimeOffStatus";
DROP TYPE IF EXISTS "TimeOffType";
DROP TYPE IF EXISTS "AccrualFrequency";
DROP TYPE IF EXISTS "AccrualMode";
DROP TYPE IF EXISTS "PayslipLineKind";
DROP TYPE IF EXISTS "PayMethod";
DROP TYPE IF EXISTS "PayRunStatus";
DROP TYPE IF EXISTS "EnrollmentStatus";
DROP TYPE IF EXISTS "BenefitType";
DROP TYPE IF EXISTS "CompDecisionStatus";
DROP TYPE IF EXISTS "CompCycleStatus";
DROP TYPE IF EXISTS "ExpenseStatus";
DROP TYPE IF EXISTS "ExpenseCategory";

-- ── benefits enrollment + dependents (same subsystem, separate names) ──
DROP TABLE IF EXISTS "OpenEnrollmentPlan" CASCADE;
DROP TABLE IF EXISTS "OpenEnrollment" CASCADE;
DROP TABLE IF EXISTS "Dependent" CASCADE;
DROP TYPE IF EXISTS "OpenEnrollmentStatus";
DROP TYPE IF EXISTS "DependentRelationship";
