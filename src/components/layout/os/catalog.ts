/* ════════════════════════════════════════════════════════════════
 * MODULE CATALOG
 * Single source of truth for every dashboard module.
 * Each module produces a title bar + tabs + filter + view content
 * via <OsModuleView moduleId="..." />.
 * ════════════════════════════════════════════════════════════════ */

import {
  // Cross-functional
  Home, Calendar as CalendarIcon, Inbox, Target, FileText, Lightbulb,
  Megaphone, Activity, Heart, Star, MessageSquareHeart,
  // People / HR
  Users, UserPlus, Award, GraduationCap, Wallet, ShieldCheck, Plane,
  Clock as ClockIcon, ClipboardList, CircleDollarSign, Briefcase,
  TrendingUp, BookCopy, Building2, IdCard,
  // Sales
  BarChart3, Handshake,
  // Operations
  Package, ShoppingCart, Laptop,
  // IT
  Server, Bug,
  // Marketing
  Megaphone as MegaphoneIcon, Mail,
  // Engineering
  Code2, GitBranch, Map as MapIcon,
  // Finance
  Calculator, ChartPie, Receipt,
  // Legal
  Scale, Lock, Stamp,
  // Support
  Headphones, MessagesSquare, BookOpen,
  // Platform
  Sparkles, Bot, Cpu, Store as StoreIcon, Settings, Hammer,
  PenTool, Palette, FlaskConical, Network, ClipboardCheck,
  CheckSquare, Pencil, Workflow, MessageCircle, BarChart, FileEdit,
  Gift, Banknote, UserCircle2, BookMarked, BadgeCheck, AlertTriangle,
  Coffee, Heart as HeartIcon, Boxes,
  type LucideIcon,
} from "lucide-react";

import type { Column, TableGroup } from "./main-table";
import type { KColumn } from "./kanban";

// ─── Color helpers (Monday palette) ─────────────────────────
export const C = {
  green:  "var(--os-c-green)",
  orange: "var(--os-c-orange)",
  red:    "var(--os-c-red)",
  blue:   "var(--os-c-blue)",
  purple: "var(--os-c-purple)",
  pink:   "var(--os-c-pink)",
  indigo: "var(--os-c-indigo)",
  teal:   "var(--os-c-teal)",
  lime:   "var(--os-c-lime)",
  brown:  "var(--os-c-brown)",
  yellow: "var(--os-c-yellow)",
  sage:   "var(--os-c-sage)",
  gray:   "var(--os-c-gray)",
};

export const GRAD = {
  orangePink:  "linear-gradient(135deg, var(--os-c-orange), var(--os-c-pink))",
  pinkPurple:  "linear-gradient(135deg, var(--os-c-pink), var(--os-c-purple))",
  bluePurple:  "linear-gradient(135deg, var(--os-c-blue), var(--os-c-purple))",
  greenTeal:   "linear-gradient(135deg, var(--os-c-green), var(--os-c-teal))",
  indigoBlue:  "linear-gradient(135deg, var(--os-c-indigo), var(--os-c-blue))",
  redPink:     "linear-gradient(135deg, var(--os-c-red), var(--os-c-pink))",
  brownOrange: "linear-gradient(135deg, var(--os-c-brown), var(--os-c-orange))",
  purpleIndigo:"linear-gradient(135deg, var(--os-c-purple), var(--os-c-indigo))",
  tealGreen:   "linear-gradient(135deg, var(--os-c-teal), var(--os-c-green))",
  yellowOrange:"linear-gradient(135deg, var(--os-c-yellow), var(--os-c-orange))",
};

// ─── Sample people pool ─────────────────────────────────────
export const PEOPLE = {
  bb: { initials: "BB", color: C.purple },
  sc: { initials: "SC", color: C.green },
  ak: { initials: "AK", color: C.orange },
  pr: { initials: "PR", color: C.pink },
  mk: { initials: "MK", color: C.teal },
  vn: { initials: "VN", color: C.indigo },
  rj: { initials: "RJ", color: C.blue },
  an: { initials: "AN", color: C.red },
};

// ─── View types a module can support ────────────────────────
export type ViewKind = "table" | "kanban" | "dashboard" | "calendar" | "gantt" | "files" | "list";

export type ViewTab = { id: ViewKind | string; label: string; Icon: LucideIcon };

// ─── Module definition ──────────────────────────────────────
export type ModuleDef = {
  id: string;                 // matches route slug
  name: string;
  description: string;
  Icon: LucideIcon;
  gradient: string;
  newLabel: string;           // e.g. "New deal", "New lead", "New ticket"
  defaultView: ViewKind;
  tabs: ViewTab[];            // tabs to show
  columns?: Column[];         // for table view
  groups?: TableGroup[];      // for table view
  kanban?: KColumn[];         // for kanban view
};

// Common tab presets
const TABS_FULL: ViewTab[] = [
  { id: "table",    label: "Main table", Icon: ClipboardList },
  { id: "kanban",   label: "Kanban",     Icon: Boxes },
  { id: "calendar", label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",    label: "Gantt",      Icon: BarChart },
  { id: "dashboard",label: "Dashboard",  Icon: ChartPie },
];

const TABS_TABLE_ONLY: ViewTab[] = [
  { id: "table",    label: "Main table", Icon: ClipboardList },
  { id: "dashboard",label: "Dashboard",  Icon: ChartPie },
];

const TABS_LIST: ViewTab[] = [
  { id: "list",     label: "List",       Icon: ClipboardList },
  { id: "dashboard",label: "Dashboard",  Icon: ChartPie },
];

const TABS_FILES: ViewTab[] = [
  { id: "files",    label: "Files",      Icon: FileText },
];

// ════════════════════════════════════════════════════════════
// Module registry — every dashboard slug
// ════════════════════════════════════════════════════════════

const TASKS_COLUMNS: Column[] = [
  { id: "status", label: "Status", type: "status" },
  { id: "owner",  label: "Owner",  type: "person" },
  { id: "due",    label: "Due",    type: "date" },
  { id: "prio",   label: "Priority", type: "priority" },
  { id: "tags",   label: "Tags",   type: "tags" },
  { id: "prog",   label: "Progress", type: "progress" },
  { id: "updates",label: "Updates", type: "updates" },
];

const TASKS_GROUPS: TableGroup[] = [
  {
    id: "this-week",
    title: "This week",
    color: C.orange,
    rows: [
      { id: "t1", name: "Ship onboarding email sequence", cells: {
        status: { value: "working" }, owner: [PEOPLE.bb, PEOPLE.sc], due: { iso: new Date().toISOString(), state: "today" },
        prio: { value: "high" }, tags: [{ label: "Growth", color: "green" }, { label: "Q3", color: "indigo" }],
        prog: { pct: 60, color: "warning" }, updates: { count: 5, hasNew: true },
      } },
      { id: "t2", name: "Fix dashboard layout collapse on mobile", cells: {
        status: { value: "stuck" }, owner: [PEOPLE.ak], due: { iso: new Date(Date.now() - 86400000).toISOString(), state: "overdue" },
        prio: { value: "critical" }, tags: [{ label: "Bug", color: "red" }],
        prog: { pct: 20, color: "danger" }, updates: { count: 12, hasNew: true },
      } },
      { id: "t3", name: "Draft Q3 board update doc", cells: {
        status: { value: "progress" }, owner: [PEOPLE.bb], due: { iso: new Date(Date.now() + 2*86400000).toISOString() },
        prio: { value: "medium" }, tags: [{ label: "Exec", color: "purple" }],
        prog: { pct: 30, color: "blue" }, updates: { count: 2 },
      } },
      { id: "t4", name: "Review Sprint Q3 retro notes", cells: {
        status: { value: "review" }, owner: [PEOPLE.pr, PEOPLE.bb], due: { iso: new Date(Date.now() + 4*86400000).toISOString() },
        prio: { value: "medium" }, tags: [{ label: "Engineering", color: "blue" }],
        prog: { pct: 80 }, updates: { count: 3 },
      } },
    ],
  },
  {
    id: "next-week",
    title: "Next week",
    color: C.blue,
    rows: [
      { id: "t5", name: "Roll out new app rail design", cells: {
        status: { value: "planning" }, owner: [PEOPLE.mk], due: { iso: new Date(Date.now() + 8*86400000).toISOString() },
        prio: { value: "high" }, tags: [{ label: "Design", color: "purple" }, { label: "Rollout", color: "orange" }],
        prog: { pct: 10, color: "blue" }, updates: { count: 0 },
      } },
      { id: "t6", name: "Plan customer advisory board meeting", cells: {
        status: { value: "pending" }, owner: [PEOPLE.bb, PEOPLE.pr], due: { iso: new Date(Date.now() + 10*86400000).toISOString() },
        prio: { value: "medium" }, tags: [{ label: "Customer", color: "teal" }],
        prog: { pct: 5 }, updates: { count: 1 },
      } },
      { id: "t7", name: "Audit billing edge cases", cells: {
        status: { value: "empty" }, owner: [PEOPLE.vn], due: { iso: new Date(Date.now() + 12*86400000).toISOString() },
        prio: { value: "low" }, tags: [{ label: "Finance", color: "teal" }],
        prog: { pct: 0 }, updates: { count: 0 },
      } },
    ],
  },
  {
    id: "done",
    title: "Done this month",
    color: C.green,
    rows: [
      { id: "t8", name: "Launch v2 design system tokens", done: true, cells: {
        status: { value: "done" }, owner: [PEOPLE.bb], due: { iso: new Date(Date.now() - 6*86400000).toISOString(), state: "done" },
        prio: { value: "high" }, tags: [{ label: "Design", color: "purple" }, { label: "Shipped", color: "green" }],
        prog: { pct: 100 }, updates: { count: 18 },
      } },
      { id: "t9", name: "Migrate workspace-level scoping", done: true, cells: {
        status: { value: "done" }, owner: [PEOPLE.ak, PEOPLE.rj], due: { iso: new Date(Date.now() - 8*86400000).toISOString(), state: "done" },
        prio: { value: "high" }, tags: [{ label: "Infra", color: "indigo" }],
        prog: { pct: 100 }, updates: { count: 24 },
      } },
    ],
  },
];

const TASKS_KANBAN: KColumn[] = [
  { id: "todo", title: "To do", color: C.gray, cards: [
    { id: "t6", title: "Plan customer advisory board meeting", refId: "TSK-145", labels: [{ label: "Customer", color: "teal" }], people: [PEOPLE.bb, PEOPLE.pr], date: { iso: new Date(Date.now() + 10*86400000).toISOString() } },
    { id: "t7", title: "Audit billing edge cases", refId: "TSK-146", labels: [{ label: "Finance", color: "teal" }], people: [PEOPLE.vn], date: { iso: new Date(Date.now() + 12*86400000).toISOString() } },
  ] },
  { id: "in-progress", title: "In progress", color: C.blue, cards: [
    { id: "t1", title: "Ship onboarding email sequence", refId: "TSK-141", labels: [{ label: "Growth", color: "green" }], people: [PEOPLE.bb, PEOPLE.sc], date: { iso: new Date().toISOString(), state: "today" } },
    { id: "t3", title: "Draft Q3 board update doc", refId: "TSK-143", labels: [{ label: "Exec", color: "purple" }], people: [PEOPLE.bb], date: { iso: new Date(Date.now() + 2*86400000).toISOString() } },
  ] },
  { id: "review", title: "Review", color: C.purple, cards: [
    { id: "t4", title: "Review Sprint Q3 retro notes", refId: "TSK-144", labels: [{ label: "Engineering", color: "blue" }], people: [PEOPLE.pr, PEOPLE.bb], date: { iso: new Date(Date.now() + 4*86400000).toISOString() } },
  ] },
  { id: "stuck", title: "Stuck", color: C.red, cards: [
    { id: "t2", title: "Fix dashboard layout collapse on mobile", refId: "TSK-142", labels: [{ label: "Bug", color: "red" }], people: [PEOPLE.ak], date: { iso: new Date(Date.now() - 86400000).toISOString(), state: "overdue" } },
  ] },
  { id: "done", title: "Done", color: C.green, cards: [
    { id: "t8", title: "Launch v2 design system tokens", refId: "TSK-138", labels: [{ label: "Shipped", color: "green" }], people: [PEOPLE.bb] },
    { id: "t9", title: "Migrate workspace-level scoping", refId: "TSK-139", labels: [{ label: "Infra", color: "indigo" }], people: [PEOPLE.ak, PEOPLE.rj] },
  ] },
];

const CRM_COLUMNS: Column[] = [
  { id: "stage",   label: "Stage",   type: "status" },
  { id: "owner",   label: "Owner",   type: "person" },
  { id: "value",   label: "Deal value", type: "number", currency: "₹" },
  { id: "close",   label: "Close date",  type: "date" },
  { id: "tags",    label: "Source",  type: "tags" },
  { id: "prob",    label: "Probability", type: "progress" },
  { id: "updates", label: "Updates", type: "updates" },
];

const CRM_GROUPS: TableGroup[] = [
  {
    id: "hot",
    title: "Hot deals",
    color: C.red,
    rows: [
      { id: "d1", name: "Acme Corp — Enterprise renewal", cells: {
        stage: { value: "review", label: "Negotiation" }, owner: [PEOPLE.bb, PEOPLE.sc], value: 850000,
        close: { iso: new Date(Date.now() + 7*86400000).toISOString() },
        tags: [{ label: "Inbound", color: "green" }], prob: { pct: 75 }, updates: { count: 14, hasNew: true },
      } },
      { id: "d2", name: "Lumen Labs — Q3 expansion", cells: {
        stage: { value: "working", label: "Proposal" }, owner: [PEOPLE.pr], value: 320000,
        close: { iso: new Date(Date.now() + 4*86400000).toISOString() },
        tags: [{ label: "Referral", color: "purple" }], prob: { pct: 60, color: "warning" }, updates: { count: 8 },
      } },
    ],
  },
  {
    id: "qualified",
    title: "Qualified",
    color: C.blue,
    rows: [
      { id: "d3", name: "NorthStar Tech — pilot", cells: {
        stage: { value: "progress", label: "Discovery" }, owner: [PEOPLE.ak], value: 180000,
        close: { iso: new Date(Date.now() + 21*86400000).toISOString() },
        tags: [{ label: "Outbound", color: "blue" }], prob: { pct: 40, color: "blue" }, updates: { count: 4 },
      } },
      { id: "d4", name: "Helio Co. — annual contract", cells: {
        stage: { value: "progress", label: "Discovery" }, owner: [PEOPLE.mk], value: 540000,
        close: { iso: new Date(Date.now() + 30*86400000).toISOString() },
        tags: [{ label: "Event", color: "pink" }], prob: { pct: 30, color: "blue" }, updates: { count: 2 },
      } },
    ],
  },
  {
    id: "won",
    title: "Closed won — this quarter",
    color: C.green,
    rows: [
      { id: "d5", name: "Spark Co — 12-mo contract", done: true, cells: {
        stage: { value: "done", label: "Closed Won" }, owner: [PEOPLE.bb], value: 420000,
        close: { iso: new Date(Date.now() - 12*86400000).toISOString(), state: "done" },
        tags: [{ label: "Inbound", color: "green" }, { label: "ROI", color: "lime" }], prob: { pct: 100 }, updates: { count: 22 },
      } },
    ],
  },
];

const CRM_KANBAN: KColumn[] = [
  { id: "lead", title: "Lead", color: C.gray, cards: [
    { id: "l1", title: "Tata Steel — initial outreach", refId: "DEAL-201", labels: [{ label: "Outbound", color: "blue" }], people: [PEOPLE.ak] },
    { id: "l2", title: "Reliance — referral from CEO", refId: "DEAL-202", labels: [{ label: "Referral", color: "purple" }], people: [PEOPLE.bb] },
  ] },
  { id: "qualified", title: "Qualified", color: C.blue, cards: [
    { id: "d3", title: "NorthStar Tech — pilot", refId: "DEAL-198", labels: [{ label: "Outbound", color: "blue" }], people: [PEOPLE.ak], date: { iso: new Date(Date.now() + 21*86400000).toISOString() } },
    { id: "d4", title: "Helio Co. — annual", refId: "DEAL-199", labels: [{ label: "Event", color: "pink" }], people: [PEOPLE.mk], date: { iso: new Date(Date.now() + 30*86400000).toISOString() } },
  ] },
  { id: "proposal", title: "Proposal", color: C.orange, cards: [
    { id: "d2", title: "Lumen Labs — Q3 expansion", refId: "DEAL-195", labels: [{ label: "Referral", color: "purple" }], people: [PEOPLE.pr], date: { iso: new Date(Date.now() + 4*86400000).toISOString() } },
  ] },
  { id: "negotiation", title: "Negotiation", color: C.purple, cards: [
    { id: "d1", title: "Acme Corp — Enterprise renewal", refId: "DEAL-190", labels: [{ label: "Inbound", color: "green" }], people: [PEOPLE.bb, PEOPLE.sc], date: { iso: new Date(Date.now() + 7*86400000).toISOString() } },
  ] },
  { id: "won", title: "Closed Won", color: C.green, cards: [
    { id: "d5", title: "Spark Co — 12-mo contract", refId: "DEAL-180", labels: [{ label: "Inbound", color: "green" }], people: [PEOPLE.bb] },
  ] },
];

const PEOPLE_COLUMNS: Column[] = [
  { id: "role",    label: "Role", type: "text" },
  { id: "dept",    label: "Department", type: "tags" },
  { id: "status",  label: "Status", type: "status" },
  { id: "manager", label: "Manager", type: "person" },
  { id: "joined",  label: "Joined", type: "date" },
  { id: "location",label: "Location", type: "text" },
];
const PEOPLE_GROUPS: TableGroup[] = [
  { id: "leadership", title: "Leadership team", color: C.purple, rows: [
    { id: "p1", name: "BigBold Tech (You)", cells: { role: "CEO", dept: [{ label: "Executive", color: "purple" }], status: { value: "done", label: "Active" }, joined: { iso: "2023-01-15", state: "done" }, location: "Mumbai" } },
    { id: "p2", name: "Sarah Cohen", cells: { role: "VP Engineering", dept: [{ label: "Engineering", color: "blue" }], status: { value: "done", label: "Active" }, manager: [PEOPLE.bb], joined: { iso: "2023-03-22", state: "done" }, location: "Bangalore" } },
  ] },
  { id: "engineering", title: "Engineering", color: C.blue, rows: [
    { id: "p3", name: "Arjun Kumar", cells: { role: "Senior Engineer", dept: [{ label: "Engineering", color: "blue" }], status: { value: "done", label: "Active" }, manager: [PEOPLE.sc], joined: { iso: "2023-06-01", state: "done" }, location: "Bangalore" } },
    { id: "p4", name: "Rajesh Joshi", cells: { role: "Frontend Lead", dept: [{ label: "Engineering", color: "blue" }, { label: "Design", color: "purple" }], status: { value: "done", label: "Active" }, manager: [PEOPLE.sc], joined: { iso: "2024-02-10", state: "done" }, location: "Pune" } },
    { id: "p5", name: "Vikram Nair", cells: { role: "DevOps", dept: [{ label: "Engineering", color: "blue" }], status: { value: "pending", label: "On leave" }, manager: [PEOPLE.sc], joined: { iso: "2024-05-20", state: "done" }, location: "Remote" } },
  ] },
  { id: "growth", title: "Growth & Operations", color: C.green, rows: [
    { id: "p6", name: "Priya Rao", cells: { role: "Head of Sales", dept: [{ label: "Sales", color: "green" }], status: { value: "done", label: "Active" }, manager: [PEOPLE.bb], joined: { iso: "2023-09-12", state: "done" }, location: "Delhi" } },
    { id: "p7", name: "Maya Kapoor", cells: { role: "HR Lead", dept: [{ label: "People", color: "pink" }], status: { value: "done", label: "Active" }, manager: [PEOPLE.bb], joined: { iso: "2024-01-08", state: "done" }, location: "Mumbai" } },
    { id: "p8", name: "Anika Nair", cells: { role: "Marketing", dept: [{ label: "Marketing", color: "orange" }], status: { value: "working", label: "Onboarding" }, manager: [PEOPLE.bb], joined: { iso: new Date(Date.now() - 5*86400000).toISOString() }, location: "Remote" } },
  ] },
];

// ─── Helper: simple table-only module with sensible defaults ─
function tableModule(args: {
  id: string; name: string; description: string;
  Icon: LucideIcon; gradient: string; newLabel: string;
  columns: Column[]; groups: TableGroup[]; kanban?: KColumn[];
}): ModuleDef {
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    Icon: args.Icon,
    gradient: args.gradient,
    newLabel: args.newLabel,
    defaultView: "table",
    tabs: args.kanban ? TABS_FULL : TABS_TABLE_ONLY,
    columns: args.columns,
    groups: args.groups,
    kanban: args.kanban,
  };
}

// ─── Helper: stub module (no data — clean coming-soon view) ──
function stubModule(args: {
  id: string; name: string; description: string;
  Icon: LucideIcon; gradient: string; newLabel?: string;
}): ModuleDef {
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    Icon: args.Icon,
    gradient: args.gradient,
    newLabel: args.newLabel ?? "New item",
    defaultView: "table",
    tabs: TABS_TABLE_ONLY,
  };
}

// ─── Quick column/group factories for common shapes ─────────
const simpleStatusColumns: Column[] = [
  { id: "status",  label: "Status", type: "status" },
  { id: "owner",   label: "Owner", type: "person" },
  { id: "due",     label: "Due", type: "date" },
  { id: "tags",    label: "Tags", type: "tags" },
  { id: "updates", label: "Updates", type: "updates" },
];

function genericGroups(prefix: string): TableGroup[] {
  return [
    { id: `${prefix}-active`, title: "Active", color: C.blue, rows: [
      { id: `${prefix}-1`, name: `${prefix} item — in flight`, cells: {
        status: { value: "working" }, owner: [PEOPLE.bb, PEOPLE.sc],
        due: { iso: new Date(Date.now() + 3*86400000).toISOString() },
        tags: [{ label: "Active", color: "blue" }], updates: { count: 3 },
      } },
      { id: `${prefix}-2`, name: `${prefix} item — needs review`, cells: {
        status: { value: "review" }, owner: [PEOPLE.pr],
        due: { iso: new Date(Date.now() + 5*86400000).toISOString() },
        tags: [{ label: "Review", color: "purple" }], updates: { count: 7, hasNew: true },
      } },
    ] },
    { id: `${prefix}-planning`, title: "Planning", color: C.indigo, rows: [
      { id: `${prefix}-3`, name: `${prefix} item — pending kick-off`, cells: {
        status: { value: "planning" }, owner: [PEOPLE.mk],
        due: { iso: new Date(Date.now() + 12*86400000).toISOString() },
        tags: [{ label: "Q3", color: "indigo" }], updates: { count: 1 },
      } },
    ] },
    { id: `${prefix}-done`, title: "Done", color: C.green, rows: [
      { id: `${prefix}-4`, name: `${prefix} item — shipped`, done: true, cells: {
        status: { value: "done" }, owner: [PEOPLE.bb],
        due: { iso: new Date(Date.now() - 4*86400000).toISOString(), state: "done" },
        tags: [{ label: "Shipped", color: "green" }], updates: { count: 12 },
      } },
    ] },
  ];
}

// ─── THE REGISTRY ───────────────────────────────────────────
const MODULES: ModuleDef[] = [
  // Cross-functional core
  tableModule({
    id: "tasks", name: "My tasks",
    description: "Personal task board · grouped by week · synced with Sprint Q3",
    Icon: CheckSquare, gradient: GRAD.bluePurple, newLabel: "New task",
    columns: TASKS_COLUMNS, groups: TASKS_GROUPS, kanban: TASKS_KANBAN,
  }),
  {
    id: "meetings", name: "Meetings", description: "Schedule, attendance, action items · synced with Google Calendar",
    Icon: CalendarIcon, gradient: GRAD.pinkPurple, newLabel: "New meeting",
    defaultView: "table", tabs: TABS_FULL,
    columns: [
      { id: "status",  label: "Status", type: "status" },
      { id: "host",    label: "Host", type: "person" },
      { id: "date",    label: "Date", type: "date" },
      { id: "tags",    label: "Type", type: "tags" },
      { id: "updates", label: "Notes", type: "updates" },
    ],
    groups: [
      { id: "today", title: "Today", color: C.orange, rows: [
        { id: "m1", name: "Sprint retro — Engineering", cells: { status: { value: "working", label: "Live now" }, host: [PEOPLE.sc], date: { iso: new Date().toISOString(), state: "today" }, tags: [{ label: "Retro", color: "purple" }], updates: { count: 4 } } },
        { id: "m2", name: "1:1 with Sarah", cells: { status: { value: "pending", label: "In 25 min" }, host: [PEOPLE.bb, PEOPLE.sc], date: { iso: new Date().toISOString(), state: "today" }, tags: [{ label: "1:1", color: "blue" }], updates: { count: 0 } } },
      ] },
      { id: "this-week", title: "This week", color: C.blue, rows: [
        { id: "m3", name: "All-hands — Monday", cells: { status: { value: "planning" }, host: [PEOPLE.bb], date: { iso: new Date(Date.now() + 3*86400000).toISOString() }, tags: [{ label: "Company", color: "red" }], updates: { count: 2 } } },
        { id: "m4", name: "Customer call — Acme Corp", cells: { status: { value: "planning" }, host: [PEOPLE.pr, PEOPLE.bb], date: { iso: new Date(Date.now() + 5*86400000).toISOString() }, tags: [{ label: "Customer", color: "teal" }], updates: { count: 1 } } },
      ] },
    ],
  },
  tableModule({
    id: "okrs", name: "OKRs — Q3", description: "Objectives, key results, check-ins · synced with KRA/KPI",
    Icon: Target, gradient: GRAD.indigoBlue, newLabel: "New objective",
    columns: [
      { id: "status",  label: "Health", type: "status" },
      { id: "owner",   label: "Owner", type: "person" },
      { id: "prog",    label: "Progress", type: "progress" },
      { id: "target",  label: "Target", type: "number" },
      { id: "current", label: "Current", type: "number" },
      { id: "updates", label: "Check-ins", type: "updates" },
    ],
    groups: [
      { id: "company", title: "Company OKRs", color: C.purple, rows: [
        { id: "o1", name: "Reach ₹4Cr ARR by Sep 30", cells: { status: { value: "working", label: "On track" }, owner: [PEOPLE.bb], prog: { pct: 68 }, target: 40000000, current: 27200000, updates: { count: 6 } } },
        { id: "o2", name: "Ship AI-OS phase 5 to GA", cells: { status: { value: "review", label: "At risk" }, owner: [PEOPLE.sc], prog: { pct: 42, color: "warning" }, target: 100, current: 42, updates: { count: 12, hasNew: true } } },
      ] },
      { id: "team", title: "Team OKRs", color: C.blue, rows: [
        { id: "o3", name: "Increase activation 25%→40%", cells: { status: { value: "done", label: "Achieved" }, owner: [PEOPLE.pr], prog: { pct: 100 }, target: 40, current: 41, updates: { count: 18 } } },
        { id: "o4", name: "Cut onboarding time by 50%", cells: { status: { value: "working" }, owner: [PEOPLE.mk], prog: { pct: 55, color: "warning" }, target: 50, current: 28, updates: { count: 8 } } },
      ] },
    ],
  }),
  tableModule({
    id: "sops", name: "SOPs", description: "Standard Operating Procedures · versioned · compliance-tracked",
    Icon: BookCopy, gradient: GRAD.tealGreen, newLabel: "New SOP",
    columns: [
      { id: "status",  label: "Status", type: "status" },
      { id: "owner",   label: "Owner", type: "person" },
      { id: "tags",    label: "Category", type: "tags" },
      { id: "prog",    label: "Compliance", type: "progress" },
      { id: "updates", label: "Versions", type: "updates" },
    ],
    groups: genericGroups("SOP"),
  }),
  stubModule({ id: "whiteboards", name: "Whiteboards", description: "Excalidraw-powered infinite canvas collaboration", Icon: PenTool, gradient: GRAD.purpleIndigo, newLabel: "New whiteboard" }),
  stubModule({ id: "docs", name: "Docs & notes", description: "Unified docs · can attach to any record", Icon: FileText, gradient: GRAD.tealGreen, newLabel: "New doc" }),
  stubModule({ id: "kudos", name: "Kudos", description: "Peer recognition with emoji reactions", Icon: HeartIcon, gradient: GRAD.redPink, newLabel: "Send kudos" }),
  stubModule({ id: "announcements", name: "Announcements", description: "Org broadcasts with acknowledgment tracking", Icon: Megaphone, gradient: GRAD.orangePink, newLabel: "New announcement" }),
  stubModule({ id: "ideas", name: "Ideas", description: "Suggestion board with voting and comments", Icon: Lightbulb, gradient: GRAD.yellowOrange, newLabel: "Submit idea" }),
  stubModule({ id: "activity", name: "Activity", description: "Global action log across the platform", Icon: Activity, gradient: GRAD.brownOrange, newLabel: "Filter activity" }),
  stubModule({ id: "inbox", name: "Inbox", description: "Unified notification inbox · all your @mentions and tasks", Icon: Inbox, gradient: GRAD.indigoBlue, newLabel: "Mark all read" }),
  stubModule({ id: "favorites", name: "Favorites", description: "Pinned destinations · your personal home", Icon: Star, gradient: GRAD.yellowOrange, newLabel: "Pin item" }),
  stubModule({ id: "candor", name: "Candor", description: "Anonymous feedback · psychological-safety pulse", Icon: MessageSquareHeart, gradient: GRAD.pinkPurple }),
  stubModule({ id: "surveys", name: "Surveys", description: "Pulse surveys · CSAT · engagement", Icon: BarChart, gradient: GRAD.bluePurple, newLabel: "New survey" }),
  stubModule({ id: "policies", name: "Policies", description: "HR policies · acknowledgment tracking", Icon: ShieldCheck, gradient: GRAD.indigoBlue, newLabel: "New policy" }),
  stubModule({ id: "process-runs", name: "Process runs", description: "SOP compliance · automated process execution", Icon: Workflow, gradient: GRAD.tealGreen }),
  stubModule({ id: "analytics", name: "Analytics", description: "Platform-wide usage and reporting", Icon: ChartPie, gradient: GRAD.bluePurple }),

  // People & HR
  tableModule({
    id: "people", name: "People directory", description: "247 employees · 6 departments · 3 locations",
    Icon: Users, gradient: GRAD.pinkPurple, newLabel: "Add person",
    columns: PEOPLE_COLUMNS, groups: PEOPLE_GROUPS,
  }),
  stubModule({ id: "organization", name: "Organization", description: "Departments, roles, hierarchy", Icon: Building2, gradient: GRAD.purpleIndigo, newLabel: "New department" }),
  tableModule({
    id: "recruiting", name: "Recruiting", description: "Jobs · candidates · interviews · offers",
    Icon: UserPlus, gradient: GRAD.orangePink, newLabel: "Post a job",
    columns: simpleStatusColumns, groups: genericGroups("Candidate"),
    kanban: [
      { id: "applied", title: "Applied", color: C.gray, cards: [{ id: "c1", title: "Anika Sharma — Senior PM", refId: "CAN-101", labels: [{ label: "Product", color: "blue" }], people: [PEOPLE.mk] }] },
      { id: "screen",  title: "Screening", color: C.blue, cards: [{ id: "c2", title: "Rohan Verma — Eng Manager", refId: "CAN-098", labels: [{ label: "Engineering", color: "indigo" }], people: [PEOPLE.sc] }] },
      { id: "interview", title: "Interview", color: C.orange, cards: [{ id: "c3", title: "Tara Iyer — Designer", refId: "CAN-095", labels: [{ label: "Design", color: "purple" }], people: [PEOPLE.mk, PEOPLE.bb] }] },
      { id: "offer",   title: "Offer", color: C.purple, cards: [{ id: "c4", title: "Jay Mehta — Senior SDR", refId: "CAN-090", labels: [{ label: "Sales", color: "green" }], people: [PEOPLE.pr] }] },
      { id: "hired",   title: "Hired", color: C.green, cards: [{ id: "c5", title: "Anika Nair — Marketing", refId: "CAN-085", labels: [{ label: "Marketing", color: "orange" }], people: [PEOPLE.bb] }] },
    ],
  }),
  tableModule({
    id: "reviews", name: "Performance reviews", description: "Cycles · 360 feedback · calibration",
    Icon: Award, gradient: GRAD.purpleIndigo, newLabel: "New review",
    columns: simpleStatusColumns, groups: genericGroups("Review"),
  }),
  stubModule({ id: "talent", name: "Talent", description: "Skills · certifications · assessments", Icon: BadgeCheck, gradient: GRAD.greenTeal, newLabel: "Add assessment" }),
  tableModule({
    id: "learning", name: "Learning (LMS)", description: "Courses · enrollments · certifications",
    Icon: GraduationCap, gradient: GRAD.indigoBlue, newLabel: "New course",
    columns: simpleStatusColumns, groups: genericGroups("Course"),
  }),
  tableModule({
    id: "compensation", name: "Compensation", description: "Cycles · decisions · salary bands",
    Icon: Wallet, gradient: GRAD.tealGreen, newLabel: "New cycle",
    columns: simpleStatusColumns, groups: genericGroups("Comp"),
  }),
  tableModule({
    id: "benefits", name: "Benefits", description: "Plans · open enrollment · life events",
    Icon: Gift, gradient: GRAD.pinkPurple, newLabel: "New plan",
    columns: simpleStatusColumns, groups: genericGroups("Plan"),
  }),
  stubModule({ id: "my-benefits", name: "My benefits", description: "Your active plans · dependents · life events", Icon: Heart, gradient: GRAD.redPink }),
  tableModule({
    id: "time-off", name: "Time off", description: "Policies · requests · balances",
    Icon: Plane, gradient: GRAD.bluePurple, newLabel: "Request time off",
    columns: simpleStatusColumns, groups: genericGroups("Request"),
  }),
  tableModule({
    id: "timesheets", name: "Timesheets", description: "Weekly submission · approval flow",
    Icon: ClockIcon, gradient: GRAD.indigoBlue, newLabel: "New entry",
    columns: simpleStatusColumns, groups: genericGroups("Timesheet"),
  }),
  stubModule({ id: "clock", name: "Clock in / out", description: "Punch in / out with geolocation", Icon: ClockIcon, gradient: GRAD.orangePink, newLabel: "Punch in" }),
  tableModule({
    id: "payroll", name: "Payroll", description: "Pay runs · payslips · earning/deduction codes",
    Icon: CircleDollarSign, gradient: GRAD.greenTeal, newLabel: "New pay run",
    columns: simpleStatusColumns, groups: genericGroups("Pay run"),
  }),
  tableModule({
    id: "onboarding", name: "Onboarding", description: "Templates · checklists · new-hire journeys",
    Icon: IdCard, gradient: GRAD.orangePink, newLabel: "New hire",
    columns: simpleStatusColumns, groups: genericGroups("Onboarding"),
  }),
  tableModule({
    id: "kra-kpi", name: "KRA / KPI", description: "Key result areas · performance indicators",
    Icon: TrendingUp, gradient: GRAD.indigoBlue, newLabel: "New KRA",
    columns: simpleStatusColumns, groups: genericGroups("KRA"),
  }),
  stubModule({ id: "workforce-planning", name: "Workforce planning", description: "Headcount planning · scenario modeling", Icon: Network, gradient: GRAD.purpleIndigo }),

  // Sales
  tableModule({
    id: "crm", name: "CRM Pipeline", description: "Leads · accounts · opportunities · 6-stage deal flow",
    Icon: BarChart3, gradient: GRAD.greenTeal, newLabel: "New deal",
    columns: CRM_COLUMNS, groups: CRM_GROUPS, kanban: CRM_KANBAN,
  }),

  // Operations
  tableModule({
    id: "procurement", name: "Procurement", description: "POs · vendors · approvals · spend analytics",
    Icon: ShoppingCart, gradient: GRAD.brownOrange, newLabel: "New PO",
    columns: simpleStatusColumns, groups: genericGroups("PO"),
  }),
  tableModule({
    id: "assets", name: "IT Assets", description: "Laptops, phones, monitors · lifecycle tracking",
    Icon: Laptop, gradient: GRAD.indigoBlue, newLabel: "Add asset",
    columns: simpleStatusColumns, groups: genericGroups("Asset"),
  }),

  // IT
  tableModule({
    id: "itsm", name: "ITSM", description: "Internal IT tickets · SEV1-5 incidents · SLA timers · KB",
    Icon: Server, gradient: GRAD.bluePurple, newLabel: "New ticket",
    columns: simpleStatusColumns, groups: genericGroups("Ticket"),
    kanban: [
      { id: "new",      title: "New",      color: C.gray,   cards: [{ id: "i1", title: "VPN slow for remote team", refId: "INC-501", labels: [{ label: "Network", color: "blue" }], people: [PEOPLE.vn] }] },
      { id: "triage",   title: "Triage",   color: C.yellow, cards: [{ id: "i2", title: "Slack workspace not loading", refId: "INC-502", labels: [{ label: "SaaS", color: "purple" }], people: [PEOPLE.ak] }] },
      { id: "active",   title: "Active",   color: C.orange, cards: [{ id: "i3", title: "Auth bug — production", refId: "INC-498", labels: [{ label: "SEV-2", color: "red" }], people: [PEOPLE.sc, PEOPLE.ak] }] },
      { id: "resolved", title: "Resolved", color: C.green,  cards: [{ id: "i4", title: "Office Wi-Fi outage", refId: "INC-490", labels: [{ label: "Hardware", color: "brown" }], people: [PEOPLE.vn] }] },
    ],
  }),

  // Marketing
  tableModule({
    id: "marketing", name: "Marketing", description: "Campaigns · content calendar · events · ROI",
    Icon: MegaphoneIcon, gradient: GRAD.orangePink, newLabel: "New campaign",
    columns: simpleStatusColumns, groups: genericGroups("Campaign"),
  }),

  // Engineering
  tableModule({
    id: "dev", name: "Engineering", description: "Sprints · releases · roadmap · retros",
    Icon: Code2, gradient: GRAD.indigoBlue, newLabel: "New sprint",
    columns: simpleStatusColumns, groups: genericGroups("Sprint"),
    kanban: [
      { id: "backlog", title: "Backlog", color: C.gray, cards: [{ id: "b1", title: "Refactor auth middleware", refId: "ENG-301", labels: [{ label: "Tech debt", color: "brown" }], people: [PEOPLE.sc] }] },
      { id: "in-progress", title: "In progress", color: C.blue, cards: [{ id: "b2", title: "Ship new app rail", refId: "ENG-298", labels: [{ label: "Design", color: "purple" }], people: [PEOPLE.rj] }] },
      { id: "review", title: "Review", color: C.purple, cards: [{ id: "b3", title: "Tasks API pagination", refId: "ENG-295", labels: [{ label: "API", color: "indigo" }], people: [PEOPLE.ak] }] },
      { id: "done", title: "Done", color: C.green, cards: [{ id: "b4", title: "Workspace scoping rollout", refId: "ENG-290", labels: [{ label: "Shipped", color: "green" }], people: [PEOPLE.sc, PEOPLE.ak] }] },
    ],
  }),

  // Finance
  tableModule({
    id: "financials", name: "Financials (Books)", description: "GL · journal entries · AP/AR · period close",
    Icon: Calculator, gradient: GRAD.tealGreen, newLabel: "New entry",
    columns: simpleStatusColumns, groups: genericGroups("Entry"),
  }),
  tableModule({
    id: "planning", name: "FP&A Planning", description: "Budgets · plans · scenarios · variance",
    Icon: ChartPie, gradient: GRAD.indigoBlue, newLabel: "New plan",
    columns: simpleStatusColumns, groups: genericGroups("Plan"),
  }),
  tableModule({
    id: "expenses", name: "Expenses", description: "Submission · OCR receipts · approval · reimbursement",
    Icon: Receipt, gradient: GRAD.brownOrange, newLabel: "New expense",
    columns: simpleStatusColumns, groups: genericGroups("Expense"),
  }),

  // Legal
  tableModule({
    id: "legal", name: "Legal", description: "Contracts · privacy requests · IP portfolio",
    Icon: Scale, gradient: GRAD.purpleIndigo, newLabel: "New contract",
    columns: simpleStatusColumns, groups: genericGroups("Contract"),
  }),

  // Support
  tableModule({
    id: "helpdesk", name: "Helpdesk", description: "Customer tickets · SLAs · CSAT · macros",
    Icon: Headphones, gradient: GRAD.orangePink, newLabel: "New ticket",
    columns: simpleStatusColumns, groups: genericGroups("Ticket"),
    kanban: [
      { id: "new", title: "New", color: C.gray, cards: [{ id: "h1", title: "Cannot log in — Acme Corp", refId: "SUP-801", labels: [{ label: "Login", color: "red" }], people: [PEOPLE.pr] }] },
      { id: "open", title: "Open", color: C.blue, cards: [{ id: "h2", title: "Billing question — Spark Co", refId: "SUP-798", labels: [{ label: "Billing", color: "teal" }], people: [PEOPLE.bb] }] },
      { id: "pending", title: "Pending customer", color: C.yellow, cards: [{ id: "h3", title: "Export feature request", refId: "SUP-790", labels: [{ label: "Feature", color: "purple" }], people: [PEOPLE.mk] }] },
      { id: "resolved", title: "Resolved", color: C.green, cards: [{ id: "h4", title: "SSO setup help", refId: "SUP-780", labels: [{ label: "Setup", color: "lime" }], people: [PEOPLE.sc] }] },
    ],
  }),

  // Platform / AI
  stubModule({ id: "sidekick", name: "Sidekick AI", description: "AI chat assistant · queries tasks/SOPs/people · runs scheduled tasks", Icon: Sparkles, gradient: GRAD.pinkPurple, newLabel: "New chat" }),
  stubModule({ id: "agents", name: "Agents", description: "Marketplace of prebuilt agents — Ria SDR, Priya HR, Maya Recruiter, Aman IT", Icon: Bot, gradient: GRAD.bluePurple, newLabel: "Hire an agent" }),
  stubModule({ id: "ai", name: "AI", description: "Generic AI query interface · prompt templates", Icon: Cpu, gradient: GRAD.bluePurple, newLabel: "New query" }),
  stubModule({ id: "autopilot", name: "Autopilot", description: "Workflow automation · process orchestration", Icon: Workflow, gradient: GRAD.tealGreen, newLabel: "New workflow" }),
  stubModule({ id: "studio", name: "Studio", description: "User-built custom tables and kanbans · scoped to workspace", Icon: Hammer, gradient: GRAD.purpleIndigo, newLabel: "New board" }),
  stubModule({ id: "build", name: "Build", description: "Low-code custom app builder", Icon: Hammer, gradient: GRAD.bluePurple, newLabel: "New app" }),
  stubModule({ id: "tools", name: "Tools", description: "Tool marketplace · bookmarked tools", Icon: Boxes, gradient: GRAD.indigoBlue }),
  stubModule({ id: "store", name: "Marketplace", description: "Browse and install apps, agents, integrations, templates", Icon: StoreIcon, gradient: GRAD.orangePink }),
  stubModule({ id: "notetaker", name: "Notetaker", description: "AI meeting notetaker · auto transcripts and action items", Icon: FileEdit, gradient: GRAD.pinkPurple }),

  // Settings & admin
  stubModule({ id: "settings", name: "Workspace settings", description: "API keys · audit log · SSO · tags · calendar sync", Icon: Settings, gradient: GRAD.indigoBlue }),
  stubModule({ id: "account", name: "Account", description: "Profile · security · 2FA · active sessions", Icon: UserCircle2, gradient: GRAD.purpleIndigo }),
  stubModule({ id: "integrations", name: "Integrations", description: "Gmail, Slack, Salesforce, GitHub, Stripe and 50+ more", Icon: Boxes, gradient: GRAD.bluePurple }),
  stubModule({ id: "brand-guide", name: "Brand guide", description: "Logo · colors · fonts · guidelines", Icon: Palette, gradient: GRAD.pinkPurple }),
  stubModule({ id: "redeem", name: "Redeem code", description: "Redeem an AppSumo or partner code", Icon: Gift, gradient: GRAD.greenTeal }),
];

// Aliases — sub-pages we want to share the parent module's identity
const ALIASES: Record<string, string> = {
  "crm/leads":      "crm",
  "crm/accounts":   "crm",
  "crm/activities": "crm",
  "crm/pipeline":   "crm",
  "crm/reports":    "crm",
  "recruiting/jobs":       "recruiting",
  "recruiting/candidates": "recruiting",
  "recruiting/interviews": "recruiting",
  "recruiting/pipeline":   "recruiting",
  "itsm/tickets":   "itsm",
  "itsm/incidents": "itsm",
  "itsm/kb":        "itsm",
  "helpdesk/tickets":   "helpdesk",
  "helpdesk/customers": "helpdesk",
  "helpdesk/macros":    "helpdesk",
  "marketing/campaigns":"marketing",
  "marketing/content":  "marketing",
  "marketing/events":   "marketing",
  "dev/sprints":  "dev",
  "dev/releases": "dev",
  "dev/roadmap":  "dev",
  "financials/accounts":     "financials",
  "financials/entries":      "financials",
  "financials/reports":      "financials",
  "financials/statements":   "financials",
  "financials/calendar":     "financials",
  "financials/integrations": "financials",
  "legal/contracts": "legal",
  "legal/privacy":   "legal",
  "legal/ip":        "legal",
  "benefits/plans":  "benefits",
  "benefits/oe":     "benefits",
  "settings/api":      "settings",
  "settings/audit":    "settings",
  "settings/identity": "settings",
  "settings/tags":     "settings",
  "settings/calendar": "settings",
  "account/security":  "account",
  "store/cat":  "store",
  "agents/ria":   "agents",
  "agents/priya": "agents",
  "agents/maya":  "agents",
  "agents/aman":  "agents",
};

export function getModule(idOrPath: string): ModuleDef | null {
  const norm = idOrPath.replace(/^\//, "");
  if (ALIASES[norm]) return MODULES.find((m) => m.id === ALIASES[norm]) ?? null;
  return MODULES.find((m) => m.id === norm) ?? null;
}

export function getAllModules(): ModuleDef[] {
  return MODULES;
}
