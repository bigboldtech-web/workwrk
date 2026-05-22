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
  MessageSquareQuote, Headphones,
  Scale, Shield, Award,
  Briefcase, UserPlus, GitBranch,
  Banknote, Heart, Target,
  ShoppingCart, Receipt, Truck,
  BookText, Layers, ClipboardList,
  GraduationCap, PlayCircle, Settings2,
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
  "workwrk-help",
  "workwrk-contracts",
  "workwrk-recruit",
  "workwrk-pay",
  "workwrk-benefits",
  "workwrk-fpa",
  "workwrk-procurement",
  "workwrk-books",
  "workwrk-learn",
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
  "workwrk-help": [
    { key: "tickets", name: "Tickets", Icon: Headphones, default: true, views: ["kanban", "table"], tagline: "Customer queue + SLA" },
    { key: "customers", name: "Customers", Icon: Users, views: ["table"], tagline: "Accounts + history" },
    { key: "macros", name: "Macros", Icon: MessageSquareQuote, views: ["table"], tagline: "Canned responses" },
  ],
  "workwrk-contracts": [
    { key: "contracts", name: "Contracts", Icon: Scale, default: true, views: ["table", "kanban"], tagline: "CLM with renewal alerts" },
    { key: "privacy", name: "Privacy (DSARs)", Icon: Shield, views: ["table"], tagline: "GDPR / CCPA queue" },
    { key: "ip", name: "IP portfolio", Icon: Award, views: ["table"], tagline: "Trademarks + patents" },
  ],
  "workwrk-recruit": [
    { key: "jobs", name: "Jobs", Icon: Briefcase, default: true, views: ["table"], tagline: "Open requisitions" },
    { key: "candidates", name: "Candidates", Icon: UserPlus, views: ["table"], tagline: "Talent pool" },
    { key: "pipeline", name: "Pipeline", Icon: GitBranch, views: ["kanban"], tagline: "Applications by stage" },
    { key: "interviews", name: "Interviews", Icon: Calendar, views: ["table"], tagline: "Scheduled + scorecards" },
  ],
  "workwrk-pay": [
    { key: "runs", name: "Pay runs", Icon: Banknote, default: true, views: ["table"], tagline: "Cycles + status" },
    { key: "groups", name: "Pay groups", Icon: Users, views: ["table"], tagline: "Pay schedules" },
  ],
  "workwrk-benefits": [
    { key: "plans", name: "Plans", Icon: Heart, default: true, views: ["table"], tagline: "Catalog + costs" },
    { key: "oe", name: "Open enrollments", Icon: Calendar, views: ["table"], tagline: "Active windows" },
  ],
  "workwrk-fpa": [
    { key: "plans", name: "Plans", Icon: Target, default: true, views: ["table"], tagline: "Driver-based forecasts" },
    { key: "variance", name: "Variance", Icon: BarChart3, views: ["table"], tagline: "Plan vs actuals" },
  ],
  "workwrk-procurement": [
    { key: "pos", name: "Purchase orders", Icon: ShoppingCart, default: true, views: ["table"], tagline: "POs + approvals" },
    { key: "invoices", name: "Invoices", Icon: Receipt, views: ["table"], tagline: "AP queue" },
    { key: "vendors", name: "Vendors", Icon: Truck, views: ["table"], tagline: "Supplier registry" },
  ],
  "workwrk-books": [
    { key: "accounts", name: "Chart of accounts", Icon: BookText, default: true, views: ["table"], tagline: "GL structure" },
    { key: "entries", name: "Journal entries", Icon: Layers, views: ["table"], tagline: "Postings" },
    { key: "reports", name: "Reports", Icon: BarChart3, views: ["table"], tagline: "P&L + Balance" },
    { key: "statements", name: "Statements", Icon: FileText, views: ["table"], tagline: "Published packs" },
    { key: "calendar", name: "Fiscal calendar", Icon: Calendar, views: ["table"], tagline: "Period close" },
  ],
  "workwrk-learn": [
    { key: "mine", name: "My courses", Icon: GraduationCap, default: true, views: ["table"], tagline: "Your enrollments" },
    { key: "catalog", name: "Catalog", Icon: PlayCircle, views: ["table"], tagline: "Available courses" },
    { key: "manage", name: "Manage", Icon: Settings2, views: ["table"], tagline: "Admin: courses + assignments", managerOnly: true },
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
