// Snapshot row counts for all critical tables before refactor.
// Run via: npx tsx scripts/baseline-counts.ts
import { config } from "dotenv";
config();

async function main() {
  // Dynamic import so DATABASE_URL is in env before the singleton runs.
  const { prisma } = await import("../src/lib/prisma");
  const counts: Record<string, number> = {};
  counts.User = await prisma.user.count();
  counts.Organization = await prisma.organization.count();
  counts.SOP = await prisma.sOP.count();
  counts.SOPVersion = await prisma.sOPVersion.count();
  counts.Task = await prisma.task.count();
  counts.OKR = await prisma.oKR.count();
  counts.KRA = await prisma.kRA.count();
  counts.KPI = await prisma.kPI.count();
  counts.Lead = await prisma.lead.count();
  counts.Account = await prisma.account.count();
  counts.Opportunity = await prisma.opportunity.count();
  counts.Ticket = await prisma.ticket.count();
  counts.SupportTicket = await prisma.supportTicket.count();
  counts.Contract = await prisma.contract.count();
  counts.Campaign = await prisma.campaign.count();
  counts.ContentItem = await prisma.contentItem.count();
  counts.Meeting = await prisma.meeting.count();
  counts.Department = await prisma.department.count();
  counts.Role = await prisma.role.count();
  counts.Kudos = await prisma.kudos.count();
  counts.Workflow = await prisma.workflow.count();
  counts.Whiteboard = await prisma.whiteboard.count();
  counts.CustomFieldDefinition = await prisma.customFieldDefinition.count();
  counts.CustomFieldValue = await prisma.customFieldValue.count();
  counts.ProductInstallation = await prisma.productInstallation.count();
  counts.Doc = await prisma.doc.count();
  counts.DocVersion = await prisma.docVersion.count();
  console.log(JSON.stringify(counts, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
