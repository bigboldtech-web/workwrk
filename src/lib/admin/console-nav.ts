// The Staff console's navigation facts (spec-admin-backoffice section 1 "Hub
// and sidebar", "Naming canon" and section 3 item 1). Pure: no React, no
// icons, so the sidebar, the breadcrumb and Search (GO TO) read one list and
// vitest proves the active-row and crumb rules in the node environment.
//
// The active row is derived from the URL on every render by longest-prefix
// SEGMENT match, never `pathname === href` (the old shell's exact match lit
// nothing on /admin/companies/<id>) and never a plain startsWith (which
// would light Companies on a hypothetical /admin/companies-archive).

export type ConsoleNavKey = "overview" | "companies" | "analytics" | "appsumo" | "staff" | "audit";

export interface ConsoleNavRow {
  key: ConsoleNavKey;
  /** The one label (naming canon). */
  label: string;
  href: string;
  /** "main" = the unlabelled first section; "console" = under CONSOLE. */
  section: "main" | "console";
}

/** Sidebar order, which is also Search's GO TO order. */
export const CONSOLE_NAV: readonly ConsoleNavRow[] = [
  { key: "overview", label: "Overview", href: "/admin", section: "main" },
  { key: "companies", label: "Companies", href: "/admin/companies", section: "main" },
  { key: "analytics", label: "Analytics", href: "/admin/analytics", section: "main" },
  { key: "appsumo", label: "AppSumo codes", href: "/admin/appsumo", section: "main" },
  { key: "staff", label: "Staff", href: "/admin/staff", section: "console" },
  { key: "audit", label: "Staff activity", href: "/admin/audit", section: "console" },
];

/**
 * Rows whose page has not shipped yet: the sidebar and Search offer no door
 * that opens a 404. Empty since Staff activity (/admin/audit) shipped in
 * spec step 5; a future row goes here until its page exists.
 */
const NOT_YET_SHIPPED: ReadonlySet<ConsoleNavKey> = new Set<ConsoleNavKey>([]);

/** The rows the sidebar and Search's GO TO render, in order. */
export function shippedConsoleNav(): ConsoleNavRow[] {
  return CONSOLE_NAV.filter((r) => !NOT_YET_SHIPPED.has(r.key));
}

/** The fixed first crumb on every console route. */
export const CONSOLE_ROOT_LABEL = "Staff console";
export const CONSOLE_ROOT_HREF = "/admin";
/** The last crumb on the console's 404. */
export const NOT_FOUND_LABEL = "Not found";

function segments(path: string): string[] {
  return path.split(/[?#]/)[0].split("/").filter(Boolean);
}

/**
 * The sidebar row a pathname belongs to: the row whose href is the longest
 * whole-segment prefix of the path. `/admin` only matches itself and paths
 * no other row claims (an unknown /admin/xyz lights Overview's parent, i.e.
 * nothing, so it returns null rather than pretend).
 */
export function activeConsoleNav(pathname: string | null | undefined): ConsoleNavKey | null {
  if (!pathname) return null;
  const path = segments(pathname);
  let best: ConsoleNavRow | null = null;
  let bestLen = -1;
  for (const row of CONSOLE_NAV) {
    const want = segments(row.href);
    if (want.length > path.length) continue;
    if (!want.every((s, i) => path[i] === s)) continue;
    if (want.length > bestLen) {
      best = row;
      bestLen = want.length;
    }
  }
  if (!best) return null;
  // /admin itself is Overview; a deeper path nobody else claims is not.
  if (best.key === "overview" && path.length > 1) return null;
  return best.key;
}

export interface ConsoleCrumb {
  label: string;
  /** Absent on the last crumb (it is the current page, not a link). */
  href?: string;
}

/** A company id the way the console routes carry it (cuid-ish; never a word). */
function isCompanySegment(s: string | undefined): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(s);
}

/**
 * The breadcrumb for a console route: "Staff console" first (links to
 * /admin), then the page's one label, then a company's name on its page.
 * The current crumb never links. A company page whose name has not loaded
 * yet shows "Company" rather than the raw id.
 */
export function consoleCrumbs(
  pathname: string | null | undefined,
  opts: { companyName?: string | null } = {},
): ConsoleCrumb[] {
  const root: ConsoleCrumb = { label: CONSOLE_ROOT_LABEL, href: CONSOLE_ROOT_HREF };
  const key = activeConsoleNav(pathname);
  const row = key ? CONSOLE_NAV.find((r) => r.key === key) ?? null : null;
  const path = segments(pathname ?? "");
  // A path no console page owns (a typo, a stale link, a page not shipped
  // yet, or anything below a company id) renders the console's own 404,
  // (admin)/admin/not-found.tsx, and the crumb says so.
  const known =
    row &&
    !NOT_YET_SHIPPED.has(row.key) &&
    path.length <= segments(row.href).length + (row.key === "companies" ? 1 : 0);
  if (!row || !known) {
    return [root, { label: NOT_FOUND_LABEL }];
  }
  if (row.key === "companies" && isCompanySegment(path[2]) && path.length === 3) {
    const name = opts.companyName?.trim();
    return [root, { label: row.label, href: row.href }, { label: name || "Company" }];
  }
  return [root, { label: row.label }];
}

/**
 * True when a request came in on the configured admin host (the proxy's own
 * comparison: port stripped, case-insensitive). False when ADMIN_HOST is
 * unset, which is local development: /admin then answers on the app host.
 */
export function isAdminHost(reqHost: string | null | undefined, configured: string | null | undefined): boolean {
  const want = configured?.trim();
  if (!want || !reqHost) return false;
  const norm = (s: string) => s.replace(/:\d+$/, "").toLowerCase();
  return norm(reqHost) === norm(want);
}

/**
 * Where a link into the product goes from the console. The admin host serves
 * no product route and bounces every relative path back to /admin, so there
 * the link must be absolute (NEXT_PUBLIC_APP_URL); with no app URL it is
 * null and the control does not render rather than loop. Off the admin host
 * (local development) a relative path reaches the product directly.
 */
export function productHref(path: string, appUrl: string | null | undefined, onAdmin: boolean): string | null {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  if (base) return `${base}${path}`;
  return onAdmin ? null : path;
}
