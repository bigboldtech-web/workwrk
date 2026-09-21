// Navigation truth: the URL decides the hub and the active sidebar row.
//
// Spec: docs/plans/ui-refresh/spec-shell.md §1.1 ("Hub + sidebar: URL-derived,
// never sticky"). Before this module the rail highlight and the secondary
// sidebar were driven by `activeAppKey`, a value persisted in localStorage and
// never re-derived from the URL, so pasting a link showed different chrome than
// the sender saw. Everything here is a pure function of `location.pathname`
// plus `location.search`; nothing reads or writes storage.
//
// This file has NO imports, on purpose, and must keep having none:
//   - vitest's node environment resolves no "@/" path alias, so anything this
//     module reached through the alias graph would make its own test unloadable
//     (src/lib/rail-apps.ts carries the same rule in its header)
//   - apps-catalog.tsx imports FROM here, never the other way round, so the
//     19-key folded-app table stays testable without loading React components

/** The eight rail hubs. Every `(dashboard)` route belongs to exactly one. */
export type HubKey =
  | "home"
  | "planner"
  | "ai"
  | "chat"
  | "teams"
  | "docs"
  | "tables"
  | "settings";

/** Declaration order is rail order; `home` is also the no-match fallback. */
export const HUB_KEYS: readonly HubKey[] = [
  "home",
  "planner",
  "ai",
  "chat",
  "teams",
  "docs",
  "tables",
  "settings",
];

const HUB_KEY_SET: ReadonlySet<string> = new Set<string>(HUB_KEYS);

/** Type guard: is this catalog app key one of the eight hubs? */
export function isHubKey(key: string): key is HubKey {
  return HUB_KEY_SET.has(key);
}

/**
 * The takeover prefixes (spec-shell 2.8). `OsShell` renders the settings frame
 * when one of these matches, `resolveHub` rule 1 reads the same list, and
 * `lastAppPath` excludes it. `/imports` is the one member outside the two door
 * prefixes: it renders inside the takeover with the Data row active until it
 * 308s into `/settings/data?tab=import`, when its entry here, its
 * `alsoActiveOn` and its `ROUTE_HUB` row are deleted together. A test pins the
 * array to exactly these three so a fourth can never be added by accident.
 */
export const SETTINGS_ROUTES: readonly string[] = ["/settings", "/account", "/imports"];

/**
 * URLs under `(dashboard)` that are resolved by a redirect before a hub is ever
 * computed, so they carry no `ROUTE_HUB` row. Four today:
 *
 *   `/today`             -> `/home`. It was never a landing: it ran a query for
 *                           the viewer's first Space and sent them into
 *                           somebody else's project list.
 *   `/dashboard`         -> `/home`.
 *   `/assigned-comments` -> `/inbox?tab=primary&type=task_comment`. Its stub
 *                           page is deleted (spec-work-home.md line 24) and its
 *                           sidebar row with it; the only thing left is the
 *                           `next.config.ts` row that keeps old links working.
 *   `/tasks`             -> `/home`. The "My Wrk" card grid, whose two cards
 *                           that read anything are now Home widgets.
 *
 * `/tasks` is the exact path only. Its seven legacy list CHILDREN
 * (assigned-to-me, today-overdue, backlog, board, calendar, gantt, sprint)
 * were the UI over the legacy `Task` table and are DELETED as of Phase 2 W4:
 * those rows are Items now (scripts/migrate-legacy-tasks.ts) and My work shows
 * them. `/tasks/[id]` is not a redirect and not deleted: it is a live page that
 * looks a legacy task id up in `LegacyRedirect` and forwards to `/item/[id]`,
 * so old links, emails and embedded doc blocks keep opening their task.
 */
export const REDIRECT_ROUTES: readonly string[] = [
  "/today",
  "/dashboard",
  "/assigned-comments",
  "/tasks",
];

/**
 * One row per route directory under `src/app/(dashboard)`, from spec §1.1.
 * Matching is longest-prefix (see `resolveHub`), so `/docs` and `/docs/trash`
 * both land on Docs and no row has to enumerate its own children.
 *
 * Adding a route without adding a row here fails the completeness test in
 * route-hub.test.ts. This table replaced `AppEntry.matchPaths`, which only 31
 * of the catalog's entries declared and which nothing read for highlighting.
 */
export const ROUTE_HUB: Readonly<Record<string, HubKey>> = {
  // ── Work ──────────────────────────────────────────────────────────
  "/home": "home",
  "/my-work": "home",
  // No `/tasks` row, and that is deliberate rather than an omission: `/tasks`
  // is a redirect (REDIRECT_ROUTES), and `/tasks/[id]` is a forwarder whose
  // only rendered output is the in-shell 404 on a miss. It takes the Work
  // fallback `resolveHub` gives every unmapped path, which is the right hub
  // for it, and adding a row would put a redirected directory back in this
  // table, which the completeness test forbids for good reason.
  "/inbox": "home",
  "/everything": "home",
  "/item": "home",
  "/spaces": "home",
  "/folders": "home",
  "/boards": "home",
  "/okrs": "home",
  "/trash": "home",
  "/templates": "home",
  "/me/weekly-review": "home",
  "/me/mentions": "home",
  "/activity": "home",
  // spec-work-home section 1 line 91 registers /favorites under the Work hub:
  // it is the page behind the FAVORITES section's "See all favorites" row, and
  // under "ai" that row swapped the rail pill, replaced the sidebar and could
  // never go active, because the Work sidebar is not rendered on /favorites.
  "/favorites": "home",
  "/marketing": "home",

  // ── Planner ───────────────────────────────────────────────────────
  "/planner": "planner",
  "/calendar": "planner",
  "/timesheets": "planner",
  "/meetings": "planner",
  "/clock": "planner",

  // ── AI ────────────────────────────────────────────────────────────
  "/sidekick": "ai",
  "/ai": "ai",
  "/agents": "ai",
  "/automation": "ai",
  "/autopilot": "ai",
  "/build": "ai",
  "/store": "ai",
  "/integrations": "ai",

  // ── Talk ──────────────────────────────────────────────────────────
  "/tlk": "chat",
  "/announcements": "chat",

  // ── Teams ─────────────────────────────────────────────────────────
  "/team": "teams",
  "/people": "teams",
  "/organization": "teams",
  "/kra-kpi": "teams",
  "/reviews": "teams",
  "/talent": "teams",
  "/candor": "teams",
  "/kudos": "teams",
  "/surveys": "teams",
  "/analytics": "teams",
  "/tools": "teams",
  "/assets": "teams",
  "/ideas": "teams",

  // ── Docs ──────────────────────────────────────────────────────────
  "/docs": "docs",
  "/library": "docs",
  "/files": "docs",
  "/canvas": "docs",
  "/notetaker": "docs",
  "/sops": "docs",
  "/process-runs": "docs",
  "/policies": "docs",
  "/agreements": "docs",

  // ── Tables ────────────────────────────────────────────────────────
  "/tables": "tables",
  "/forms": "tables",

  // ── Settings ──────────────────────────────────────────────────────
  "/settings": "settings",
  "/account": "settings",
  "/imports": "settings",
};

/**
 * The breadcrumb fallback (spec-shell 2.1): the canon label of every static
 * route directory. Every `ROUTE_HUB` key has a row, and a nested static
 * directory (`/people/departments`, `/sops/new`) has its own row under the
 * hub row that owns it, so the fallback can print the hierarchy
 * (`Teams › Directory › Departments`) and the last crumb equals the page
 * title. A page that declares no `<Breadcrumb items/>` renders the trail
 * `resolveCrumbTrail` builds; a dynamic route gets its container label only
 * (and must declare its own object crumb). Strings and nothing else: never a
 * role check, a count or a fetched value. Labels follow naming-canon.md and
 * the sidebar rows in sidebar-map.md.
 */
export const ROUTE_TITLES: Readonly<Record<string, string>> = {
  "/home": "Home",
  "/my-work": "My work",
  "/inbox": "Inbox",
  "/everything": "Everything",
  "/item": "Task",
  "/spaces": "Spaces",
  "/folders": "Folder",
  "/boards": "List",
  "/okrs": "Goals",
  "/trash": "Trash",
  "/templates": "Templates",
  "/me/weekly-review": "Weekly review",
  "/me/mentions": "Mentions",
  "/activity": "Activity",
  "/marketing": "Marketing",
  "/planner": "Calendar",
  "/calendar": "Calendar",
  "/timesheets": "Timesheets",
  "/meetings": "Meetings",
  "/clock": "Clock in/out",
  "/sidekick": "Ask AI",
  "/ai": "Ask AI",
  "/agents": "Agents",
  "/automation": "Automation",
  "/autopilot": "Workflows",
  "/build": "Build apps",
  "/store": "Marketplace",
  "/integrations": "Integrations",
  "/favorites": "Favorites",
  "/tlk": "Talk",
  "/announcements": "Announcements",
  "/team": "My team",
  "/people": "Directory",
  "/organization": "Org chart",
  "/kra-kpi": "KRAs & KPIs",
  "/reviews": "Review cycles",
  "/talent": "Talent",
  "/candor": "Candor",
  "/kudos": "Kudos",
  "/surveys": "Surveys",
  "/analytics": "Analytics",
  "/tools": "Tools",
  "/assets": "Assets",
  "/ideas": "Ideas",
  "/docs": "Docs",
  "/library": "Docs",
  "/files": "Files",
  "/canvas": "Canvases",
  "/notetaker": "Notetaker",
  "/sops": "SOPs",
  "/process-runs": "Run history",
  "/policies": "Policies",
  "/agreements": "Contracts",
  "/tables": "Tables",
  "/forms": "Forms",
  "/settings": "Workspace settings",
  "/account": "My settings",
  "/imports": "Import",

  // ── Nested static directories (the hierarchy under a hub row) ──────
  //
  "/my-work/personal": "Personal list",
  "/marketing/campaigns": "Campaigns",
  "/marketing/events": "Events",
  "/marketing/content": "Content library",
  // "/docs/trash" is gone: it 308s to /trash?tab=archived&type=doc, the one
  // Trash (spec-spaces-lists section 2). A ROUTE_TITLES row for a route with
  // no page fails the completeness test, which is the test doing its job.
  "/automation/workflows": "Workflows",
  "/automation/templates": "Templates",
  "/automation/logs": "Logs",
  "/automation/health": "Health",
  "/automation/usage": "Usage",
  "/automation/connections": "Connections",
  "/people/me": "My profile",
  "/people/departments": "Departments",
  "/people/roles": "Job titles",
  "/people/skills": "Skills",
  "/team/alignment": "Alignment",
  "/team/reviews": "Weekly reviews",
  "/team/kpi-reviews": "KPI reviews",
  "/team/rollup": "Sub-teams",
  "/team/workload": "Workload",
  "/kra-kpi/review": "KPI reviews",
  "/sops/new": "New SOP",
  "/sops/my-sops": "My SOPs",
  "/sops/compliance": "SOP compliance",
  "/sops/manage": "Organize",
  "/policies/compliance": "Policy compliance",
};

// Longest first, like ROUTE_HUB_PREFIXES: the crumb scan stops at the deepest
// row that owns the path.
const ROUTE_TITLE_PREFIXES: readonly string[] = Object.keys(ROUTE_TITLES).sort(
  (a, b) => b.length - a.length,
);

/**
 * The 19 catalog apps that are folded into a hub: they keep their routes, their
 * rows and their searchability, but they are not their own rail icon. The hub
 * named here is where the app's rows live (spec §1.2 rule 3).
 *
 * This is the single source of truth for the fold; `apps-catalog.tsx` reads it
 * to stamp `AppEntry.hubKey`, and `rail-apps.ts` drops any app carrying one
 * from the rail. It lives here rather than in the catalog so the CI test that
 * asserts the 19 keys can import it without loading the component graph.
 */
export const FOLDED_APP_HUB: Readonly<Record<string, HubKey>> = {
  goals: "home",
  timesheets: "planner",
  library: "docs",
  clips: "docs",
  sops: "docs",
  policies: "docs",
  agreements: "docs",
  reviews: "teams",
  candor: "teams",
  kudos: "teams",
  surveys: "teams",
  announcements: "chat",
  forms: "tables",
  automation: "ai",
  tools: "teams",
  assets: "teams",
  build: "ai",
  store: "ai",
  trash: "home",
};

/**
 * Work's landing URL.
 *
 * `/home`: the quiet widget page, which now exists. Before this it was
 * `/today`, which was not a landing at all: it ran a query for the viewer's
 * earliest readable Space and redirected them into it, so "go home" meant "go
 * to somebody's project list", and a person with no Space landed on /spaces.
 *
 * This constant is the one every in-app href reads. `next.config.ts` carries
 * its ONE mirror (it runs before the "@/" alias exists), and both flip in the
 * same edit.
 *
 * Whatever it points at, it points at a path the table owns: a test asserts
 * `resolveHubPrefix(WORK_HOME_HREF)` matches a row, so the Work landing can
 * never be the one landing that resolves by the no-match fallback.
 */
export const WORK_HOME_HREF = "/home";

/** Trailing slashes and empty strings normalised to a comparable path. */
function normalisePath(pathname: string): string {
  const path = (pathname || "/").split("?")[0].split("#")[0];
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "") || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

/** A prefix matches a path when it is the path or an ancestor of it. */
function prefixMatches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

// Longest first, so the scan can stop at the first hit and `/me/weekly-review`
// can never lose to a shorter row that happens to be declared earlier.
const ROUTE_HUB_PREFIXES: readonly string[] = Object.keys(ROUTE_HUB).sort(
  (a, b) => b.length - a.length,
);

/**
 * The `ROUTE_HUB` prefix that owns this path, or null when the table has no row
 * for it. Exported so the completeness test can tell "matched a row" apart from
 * "fell through to the Work fallback"; product code wants `resolveHub`.
 */
export function resolveHubPrefix(pathname: string): string | null {
  const path = normalisePath(pathname);
  for (const prefix of ROUTE_HUB_PREFIXES) {
    if (prefixMatches(path, prefix)) return prefix;
  }
  return null;
}

/** True when this path renders inside the Settings takeover (spec §2.8). */
export function isSettingsRoute(pathname: string): boolean {
  const path = normalisePath(pathname);
  return SETTINGS_ROUTES.some((prefix) => prefixMatches(path, prefix));
}

/** True when this path is resolved by a redirect before any hub is computed. */
export function isRedirectRoute(pathname: string): boolean {
  const path = normalisePath(pathname);
  return REDIRECT_ROUTES.some((prefix) => prefixMatches(path, prefix));
}

/**
 * The hub a URL belongs to. Guarantees: total (always returns a hub), pure (no
 * storage, no session, no module state), and stable for a given path.
 *
 * Resolution order, exactly spec §1.1:
 *   1. a `SETTINGS_ROUTES` path is `settings`, whatever else would match
 *   2. longest-prefix match over `ROUTE_HUB`
 *   3. no match is `home` (Work), and the caller renders no active sidebar row
 */
export function resolveHub(pathname: string): HubKey {
  if (isSettingsRoute(pathname)) return "settings";
  const prefix = resolveHubPrefix(pathname);
  return prefix ? ROUTE_HUB[prefix] : "home";
}

/**
 * The crumb a page gets when it declares none: the canon title of the owning
 * route prefix, or null when the path matches no row (the bar then shows the
 * hub alone). Pure, so the top bar and a test read the same answer.
 */
export function resolveCrumbFallback(pathname: string): string | null {
  const trail = resolveCrumbTrail(pathname);
  return trail.length > 0 ? trail[trail.length - 1].label : null;
}

/**
 * The fallback crumbs after the hub, outermost first: one per `ROUTE_TITLES`
 * row that is the path or an ancestor of it, so `/people/departments` gives
 * `[Directory (/people), Departments]` and `/docs/abc123` gives `[Docs]`.
 * Every crumb but the last carries its href; the last is the page itself. A
 * path no row owns gives `[]`, and the bar shows the hub alone. Pure, so the
 * top bar and a test read the same answer.
 */
export function resolveCrumbTrail(pathname: string): { label: string; href?: string }[] {
  if (!resolveHubPrefix(pathname)) return [];
  const path = normalisePath(pathname);
  const owned = ROUTE_TITLE_PREFIXES.filter((prefix) => prefixMatches(path, prefix)).sort(
    (a, b) => a.length - b.length,
  );
  return owned.map((prefix, i) =>
    i === owned.length - 1 ? { label: ROUTE_TITLES[prefix] } : { label: ROUTE_TITLES[prefix], href: prefix },
  );
}

/** What a hub's landing URL may depend on. The only two branches in the table. */
export type HubHrefContext = {
  /**
   * Whether the org has the Talk premium module on. Talk is the one hub whose
   * landing is conditional, and it is conditional on module state alone:
   * Announcements is not module-gated, so the hub must stay reachable with the
   * module off. Undefined is read as "on", which is today's behaviour.
   */
  talkModuleOn?: boolean;
  /** Owner or Admin: the only viewers whose Settings door is the workspace one. */
  canManageWorkspace?: boolean;
};

/**
 * Where a rail click lands. Guarantees: every hub returns a path that exists
 * today, and the only two branches are the two the spec names (Talk on module
 * state, Settings on role). Never reads the URL, so it cannot go sticky.
 */
export function hubDefaultHref(hub: HubKey, ctx: HubHrefContext = {}): string {
  switch (hub) {
    case "home":
      return WORK_HOME_HREF;
    case "planner":
      return "/planner";
    case "ai":
      return "/sidekick";
    case "chat":
      // Module off: Announcements is the hub's only content, so it is the door.
      return ctx.talkModuleOn === false ? "/announcements" : "/tlk";
    case "teams":
      // The Directory, not /team: /team is gated on having reports, so a rail
      // pill pointed at it would land a plain Member on a denial.
      return "/people";
    case "docs":
      return "/docs";
    case "tables":
      return "/tables";
    case "settings":
      return ctx.canManageWorkspace ? "/settings" : "/account/profile";
  }
}

/** The shape `resolveActiveRow` needs from a sidebar row. Rows never take an
 *  `active` prop; they declare where they point and how strictly to match. */
export type ActiveRowInput = {
  /** Absolute path, optionally with a query string (`/okrs?mine=1`). */
  href: string;
  /** `prefix` (default) also matches descendants; `exact` matches only itself. */
  match?: "exact" | "prefix";
};

function toSearchParams(search: string | URLSearchParams | null | undefined): URLSearchParams {
  if (!search) return new URLSearchParams();
  if (typeof search === "string") return new URLSearchParams(search.replace(/^\?/, ""));
  return search;
}

/**
 * Which sidebar row is current. Guarantees, exactly spec §1.1:
 *   - exactly one row is active, or none; the first row is never a fallback
 *   - a row whose href carries a query string matches only when every param it
 *     declares equals the current one (extra current params are ignored)
 *   - among matching rows the longest `href` wins, which is what makes
 *     `/okrs?mine=1` beat `/okrs` and `/docs/trash` beat `/docs`. Path
 *     specificity is compared first and the query only breaks a tie, so a
 *     shallow row carrying a long query string can never outrank a strictly
 *     deeper path row
 *   - ties go to the row declared first
 */
export function resolveActiveRow<T extends ActiveRowInput>(
  rows: readonly T[],
  pathname: string,
  search?: string | URLSearchParams | null,
): T | undefined {
  const path = normalisePath(pathname);
  const current = toSearchParams(search);

  let best: T | undefined;
  let bestPathLength = -1;
  let bestHrefLength = -1;

  for (const row of rows) {
    const [rawPath, rawQuery] = row.href.split("?");
    const rowPath = normalisePath(rawPath);

    const pathHit =
      row.match === "exact" ? path === rowPath : prefixMatches(path, rowPath);
    if (!pathHit) continue;

    if (rawQuery) {
      const declared = new URLSearchParams(rawQuery);
      let queryHit = true;
      for (const [key, value] of declared) {
        if (current.get(key) !== value) {
          queryHit = false;
          break;
        }
      }
      if (!queryHit) continue;
    }

    // Path first, query second, and strictly greater on both, so a tie keeps
    // the row declared first.
    const isBetter =
      rowPath.length > bestPathLength ||
      (rowPath.length === bestPathLength && row.href.length > bestHrefLength);
    if (isBetter) {
      best = row;
      bestPathLength = rowPath.length;
      bestHrefLength = row.href.length;
    }
  }

  return best;
}
