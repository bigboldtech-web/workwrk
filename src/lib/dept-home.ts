// Map a department name → that team's natural product landing page.
//
// Sales person logging in expects to land in /crm. IT person in /itsm.
// HR in /people. The mapping uses case-insensitive substring matches
// so common variants ("Sales", "Sales Team", "B2C Sales") all
// resolve. Returns null when no known match — caller falls back to
// /dashboard.

interface DeptHome {
  href: string;
  label: string;
  blurb: string;
}

const RULES: { keyword: string; home: DeptHome }[] = [
  { keyword: "sale",        home: { href: "/crm",          label: "Sales workspace", blurb: "Pipeline, leads, accounts, deals." } },
  { keyword: "market",      home: { href: "/marketing",    label: "Marketing workspace", blurb: "Campaigns, content, events." } },
  { keyword: "engineer",    home: { href: "/dev",          label: "Engineering workspace", blurb: "Sprints, releases, roadmap." } },
  { keyword: "developer",   home: { href: "/dev",          label: "Engineering workspace", blurb: "Sprints, releases, roadmap." } },
  { keyword: "tech",        home: { href: "/dev",          label: "Engineering workspace", blurb: "Sprints, releases, roadmap." } },
  { keyword: "it ",         home: { href: "/itsm",         label: "IT workspace",     blurb: "Tickets, incidents, knowledge base." } },
  { keyword: "support",     home: { href: "/helpdesk",     label: "Support workspace", blurb: "Customer tickets, macros, CSAT." } },
  { keyword: "success",     home: { href: "/helpdesk",     label: "Success workspace", blurb: "Customer tickets, macros, CSAT." } },
  { keyword: "legal",       home: { href: "/legal",        label: "Legal workspace",  blurb: "Contracts, privacy, IP." } },
  { keyword: "hr",          home: { href: "/people",       label: "People workspace", blurb: "Directory, time off, onboarding." } },
  { keyword: "people",      home: { href: "/people",       label: "People workspace", blurb: "Directory, time off, onboarding." } },
  { keyword: "finance",     home: { href: "/expenses",     label: "Finance workspace", blurb: "Expenses, planning, books." } },
  { keyword: "account",     home: { href: "/expenses",     label: "Finance workspace", blurb: "Expenses, planning, books." } },
  { keyword: "operation",   home: { href: "/procurement",  label: "Operations workspace", blurb: "Procurement, assets, field ops." } },
];

export function deptHomeFor(departmentName: string | null | undefined): DeptHome | null {
  if (!departmentName) return null;
  const needle = departmentName.toLowerCase();
  for (const { keyword, home } of RULES) {
    if (needle.includes(keyword)) return home;
  }
  // Bare "IT" alone (no trailing space) — handle as a special case.
  if (needle.trim() === "it") return { href: "/itsm", label: "IT workspace", blurb: "Tickets, incidents, knowledge base." };
  return null;
}
