-- Phase 3: Procurement / AP. Vendor → PurchaseOrder → Invoice
-- triangle. Multi-line items + three-way matching are v2.

CREATE TYPE "PurchaseOrderStatus" AS ENUM (
  'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SENT', 'RECEIVED', 'CLOSED'
);

CREATE TYPE "InvoiceStatus" AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'PAID'
);

CREATE TABLE "Vendor" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "email"            TEXT,
  "contactName"      TEXT,
  "phone"            TEXT,
  "taxId"            TEXT,
  "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
  "archived"         BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vendor_organizationId_name_key" ON "Vendor"("organizationId", "name");
CREATE INDEX "Vendor_organizationId_archived_idx" ON "Vendor"("organizationId", "archived");

ALTER TABLE "Vendor"
  ADD CONSTRAINT "Vendor_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PurchaseOrder" (
  "id"                   TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL,
  "number"               TEXT NOT NULL,
  "vendorId"             TEXT NOT NULL,
  "requesterId"          TEXT NOT NULL,
  "approverId"           TEXT,
  "description"          TEXT NOT NULL,
  "amount"               DECIMAL(12,2) NOT NULL,
  "currency"             TEXT NOT NULL DEFAULT 'USD',
  "status"               "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "expectedDeliveryDate" TIMESTAMP(3),
  "receivedAt"           TIMESTAMP(3),
  "submittedAt"          TIMESTAMP(3),
  "decisionAt"           TIMESTAMP(3),
  "decisionNote"         TEXT,
  "notes"                TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_organizationId_number_key" ON "PurchaseOrder"("organizationId", "number");
CREATE INDEX "PurchaseOrder_organizationId_status_idx" ON "PurchaseOrder"("organizationId", "status");
CREATE INDEX "PurchaseOrder_vendorId_status_idx" ON "PurchaseOrder"("vendorId", "status");
CREATE INDEX "PurchaseOrder_requesterId_status_idx" ON "PurchaseOrder"("requesterId", "status");
CREATE INDEX "PurchaseOrder_approverId_status_idx" ON "PurchaseOrder"("approverId", "status");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_approverId_fkey"
  FOREIGN KEY ("approverId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Invoice" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "vendorId"        TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "invoiceNumber"   TEXT NOT NULL,
  "amount"          DECIMAL(12,2) NOT NULL,
  "currency"        TEXT NOT NULL DEFAULT 'USD',
  "issueDate"       TIMESTAMP(3) NOT NULL,
  "dueDate"         TIMESTAMP(3) NOT NULL,
  "status"          "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt"          TIMESTAMP(3),
  "decisionAt"      TIMESTAMP(3),
  "decisionNote"    TEXT,
  "approverId"      TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_organizationId_vendorId_invoiceNumber_key"
  ON "Invoice"("organizationId", "vendorId", "invoiceNumber");
CREATE INDEX "Invoice_organizationId_status_idx" ON "Invoice"("organizationId", "status");
CREATE INDEX "Invoice_organizationId_dueDate_idx" ON "Invoice"("organizationId", "dueDate");
CREATE INDEX "Invoice_vendorId_status_idx" ON "Invoice"("vendorId", "status");
CREATE INDEX "Invoice_purchaseOrderId_idx" ON "Invoice"("purchaseOrderId");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_approverId_fkey"
  FOREIGN KEY ("approverId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
