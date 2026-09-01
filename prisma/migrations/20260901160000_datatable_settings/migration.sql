-- Sheet-level settings bucket on DataTable (holds named ranges, extensible).
ALTER TABLE "DataTable" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
