// "Marketing (legacy) CSV": one file per entity, so an organization can take
// its campaigns, content and events without importing them (spec-tools-misc
// section 2.7 "where the work goes", item 3). Money is a number column with
// a Currency column beside it: a campaign's own currency where it is set,
// the org currency (settings.currency) otherwise.

import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/csv";
import { orgCurrencyFromSettings } from "@/lib/org/org-currency";
import {
  campaignsToCsvRows,
  contentToCsvRows,
  eventsToCsvRows,
  MARKETING_CSV_COLUMNS,
  type MarketingKind,
} from "./legacy-map";

export async function legacyMarketingCsv(organizationId: string, kind: MarketingKind): Promise<{ csv: string; rows: number }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
  const currency = orgCurrencyFromSettings(org?.settings);
  const columns = [...MARKETING_CSV_COLUMNS[kind]];

  if (kind === "campaigns") {
    const rows = await prisma.campaign.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    return { csv: toCsv(campaignsToCsvRows(rows, currency), columns), rows: rows.length };
  }
  const campaigns = await prisma.campaign.findMany({ where: { organizationId }, select: { id: true, name: true } });
  const titles = new Map(campaigns.map((c) => [c.id, c.name]));
  if (kind === "content") {
    const rows = await prisma.contentItem.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    return { csv: toCsv(contentToCsvRows(rows, titles), columns), rows: rows.length };
  }
  const rows = await prisma.eventBrief.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  return { csv: toCsv(eventsToCsvRows(rows, currency, titles), columns), rows: rows.length };
}
