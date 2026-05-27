-- Forms primitive: FormDefinition + FormSubmission.
-- User-built forms. Field definitions in a JSON array. Submissions
-- pile up in an inbox and can optionally insert a row into a target
-- Studio board.

CREATE TABLE "FormDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "targetBoardId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormDefinition_organizationId_idx" ON "FormDefinition"("organizationId");
CREATE INDEX "FormDefinition_createdById_idx" ON "FormDefinition"("createdById");
CREATE INDEX "FormSubmission_organizationId_formId_idx" ON "FormSubmission"("organizationId", "formId");
CREATE INDEX "FormSubmission_formId_submittedAt_idx" ON "FormSubmission"("formId", "submittedAt");

ALTER TABLE "FormDefinition" ADD CONSTRAINT "FormDefinition_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "FormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
