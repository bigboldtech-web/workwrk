-- Views-catalog: four genuinely-new view types (the rest of the catalog
-- is driven via View.config on existing types). Additive enum values.
ALTER TYPE "ViewType" ADD VALUE 'CARDS';
ALTER TYPE "ViewType" ADD VALUE 'PIVOT';
ALTER TYPE "ViewType" ADD VALUE 'HIERARCHY';
ALTER TYPE "ViewType" ADD VALUE 'ACTIVITY';
