-- Per-List statuses (ClickUp parity backbone #1). Additive + nullable:
-- null = board uses the canonical default status trio.
ALTER TABLE "Board" ADD COLUMN "statuses" JSONB;
