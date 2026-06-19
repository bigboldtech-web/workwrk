-- Agreement folders (category) + reusable templates.
ALTER TABLE "Agreement" ADD COLUMN "category" TEXT;
ALTER TABLE "Agreement" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Agreement_isTemplate_idx" ON "Agreement" ("isTemplate");
