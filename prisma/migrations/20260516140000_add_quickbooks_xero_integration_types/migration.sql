-- QuickBooks + Xero integration support. Schema-only enum extension —
-- runtime code lives in src/lib/integrations/{quickbooks,xero}.ts and
-- src/app/api/integrations/{quickbooks,xero}/*.ts. Activation is gated
-- on the matching OAuth credentials being present in env.

ALTER TYPE "IntegrationType" ADD VALUE 'QUICKBOOKS';
ALTER TYPE "IntegrationType" ADD VALUE 'XERO';
