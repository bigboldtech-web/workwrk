// Per-product board catalog.
//
// Each entry in PRODUCT_CATALOG declares the product surface (CRM, Dev,
// Marketing, ITSM…). This file declares what *boards* live inside each
// product — the monday-style workspace tree shown in the left column
// when the user is inside an app. Boards are the actual work surfaces:
// the Pipeline kanban, the Leads table, the Bug Queue, the Sprint
// board, etc.
//
// Conventions:
// - `key` is unique within a product and appears in the URL as the
//   route segment (`/crm/pipeline`, `/crm/leads`).
// - `default: true` means this board is the landing surface when the
//   user clicks the product (e.g., `/crm` redirects to `/crm/pipeline`).
//   Exactly one board per product should be flagged default.
// - `views` declares the alternate view modes a board ships with
//   (table / kanban / gantt / calendar / chart). The board page may
//   honour or ignore this — for now it's a forward-looking hint the
//   AppWorkspaceNav uses to show the small view-mode chip.

import type { LucideIcon } from "lucide-react";
import {
  TrendingUp, Users, Building2, Activity, BarChart3,
  Code, Rocket, Map,
  Megaphone, FileText, Calendar,
  Ticket, AlertTriangle, BookOpen,
} from "lucide-react";

export type BoardView = "table" | "kanban" | "gantt" | "calendar" | "chart";

export interface ProductBoard {
  key: string;
  name: string;
  Icon: LucideIcon;
  /** Tagline shown under the workspace nav label on hover / tooltip. */
  tagline?: string;
  /** Marks the default landing board for the product. */
  default?: boolean;
  /** Views this board can render. The first entry is the default. */
  views?: BoardView[];
  /** Hide from non-admin / non-manager users. */
  managerOnly?: boolean;
}

// Products that have been converted to the boards model — i.e. their
// route pages exist as `/<product>/<board>/page.tsx`. AppWorkspaceNav
// only renders the boards tree for products in this set; the others
// declare boards here for forward-planning but the nav falls back to
// "single product link + suite siblings" until the routes are written.
export const CONVERTED_PRODUCTS = new Set<string>([
  "workwrk-crm",
  "workwrk-dev",
  "workwrk-campaigns",
  "workwrk-itsm",
]);

// Map of product slug → ordered list of boards inside that product.
// Products not listed fall back to "no boards yet" in the nav (the
// product's page itself still renders normally).
export const PRODUCT_BOARDS: Record<string, ProductBoard[]> = {
  "workwrk-crm": [
    { key: "pipeline", name: "Pipeline", Icon: TrendingUp, default: true, views: ["kanban", "table"], tagline: "Deals by stage" },
    { key: "leads", name: "Leads", Icon: Users, views: ["table", "kanban"], tagline: "Inbound + outbound" },
    { key: "accounts", name: "Accounts", Icon: Building2, views: ["table"], tagline: "Companies you sell to" },
    { key: "activities", name: "Activities", Icon: Activity, views: ["table", "calendar"], tagline: "Calls, emails, meetings" },
    { key: "reports", name: "Reports", Icon: BarChart3, views: ["chart"], tagline: "Pipeline analytics", managerOnly: true },
  ],
  "workwrk-dev": [
    { key: "sprints", name: "Sprints", Icon: Code, default: true, views: ["table"], tagline: "Active + planned" },
    { key: "releases", name: "Releases", Icon: Rocket, views: ["table"], tagline: "Shipped + scheduled" },
    { key: "roadmap", name: "Roadmap", Icon: Map, views: ["table", "gantt"], tagline: "Themes + outcomes" },
  ],
  "workwrk-campaigns": [
    { key: "campaigns", name: "Campaigns", Icon: Megaphone, default: true, views: ["kanban", "table"], tagline: "Active + planned" },
    { key: "content", name: "Content", Icon: FileText, views: ["kanban", "table"], tagline: "Editorial calendar" },
    { key: "events", name: "Events", Icon: Calendar, views: ["table"], tagline: "Webinars + field" },
  ],
  "workwrk-itsm": [
    { key: "tickets", name: "Tickets", Icon: Ticket, default: true, views: ["kanban", "table"], tagline: "Open + assigned" },
    { key: "incidents", name: "Incidents", Icon: AlertTriangle, views: ["table"], tagline: "Active outages" },
    { key: "kb", name: "Knowledge base", Icon: BookOpen, views: ["table"], tagline: "Runbooks + SOPs" },
  ],
};

export function getDefaultBoardKey(productSlug: string): string | null {
  const boards = PRODUCT_BOARDS[productSlug];
  if (!boards || boards.length === 0) return null;
  return (boards.find((b) => b.default) ?? boards[0]).key;
}

export function getBoard(productSlug: string, boardKey: string): ProductBoard | null {
  const boards = PRODUCT_BOARDS[productSlug];
  if (!boards) return null;
  return boards.find((b) => b.key === boardKey) ?? null;
}
