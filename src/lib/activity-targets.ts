// What an activity row points at, and whether that is a link.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/activity):
// "the target as a link chip ... resolved from the lowercase `targetType` the
// app actually writes".
//
// WHY A TABLE, AND WHY IT IS LOWERCASE. The page's old TARGET_VISUAL map knew
// ten `targetType` strings and gave four of them an href. The app writes
// FORTY-FIVE distinct strings, in four casings at once: "task" and "TASK" and
// "TASK" again from a third file, "sop" and "SOP", "okr" and "OKR",
// "organization" and "Organization", "review_cycle" and "ReviewCycle". So most
// rows rendered as an unlinked grey chip, and the one Task link that existed
// pointed at `/tasks?id=` which is the card grid and reads no `id` parameter,
// so it was dead (work-tasks #8).
//
// Everything is normalised to lower snake_case here, once, and every family
// the app writes has a row. A family with no page is a deliberate `href: null`
// rather than an omission, so "we have no page for this" and "nobody wrote a
// row for this" are different states.
//
// Pure: no React, no prisma.

/** The user-facing families the Filter panel's Type list offers. */
export type ActivityFamily =
  | "tasks" | "docs" | "sops" | "goals" | "people" | "containers"
  | "kudos" | "settings" | "finance" | "other";

export const ACTIVITY_FAMILY_LABEL: Readonly<Record<ActivityFamily, string>> = {
  tasks: "Tasks",
  docs: "Docs",
  sops: "SOPs",
  goals: "Goals",
  people: "People",
  containers: "Spaces and Lists",
  kudos: "Kudos",
  settings: "Settings",
  finance: "Finance",
  other: "Other",
};

export interface TargetDef {
  /** The glyph key the chip draws; the page maps it to a Lucide icon. */
  glyph: "task" | "doc" | "sop" | "goal" | "person" | "space" | "list" | "folder" | "table" | "canvas" | "file" | "form" | "kudos" | "settings" | "finance" | "dot";
  family: ActivityFamily;
  /** A path builder, or null when the family genuinely has no page. */
  href: ((id: string) => string) | null;
}

/**
 * Normalise a stored `targetType` to the one key this table uses.
 * "ReviewCycle" -> "review_cycle", "TASK" -> "task", "accounting-period" ->
 * "accounting_period".
 */
export function normaliseTargetType(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .replace(/[-\s]+/g, "_")
    // CamelCase to snake_case, before the lowercase pass.
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

const TARGETS: Readonly<Record<string, TargetDef>> = {
  // Work
  task: { glyph: "task", family: "tasks", href: (id) => `/item/${id}` },
  item: { glyph: "task", family: "tasks", href: (id) => `/item/${id}` },
  board: { glyph: "list", family: "containers", href: (id) => `/boards/${id}` },
  list: { glyph: "list", family: "containers", href: (id) => `/boards/${id}` },
  // /spaces/[slug] takes a SLUG, and an id there renders the in-shell 404.
  // Unlike /boards/[slug], which 308s an id to its slug, there is no id door
  // for a Space, so the chip renders as plain text rather than as a link that
  // is guaranteed to 404 the moment a writer emits targetType "space".
  space: { glyph: "space", family: "containers", href: null },
  folder: { glyph: "folder", family: "containers", href: (id) => `/folders/${id}` },
  // Knowledge
  doc: { glyph: "doc", family: "docs", href: (id) => `/docs/${id}` },
  note: { glyph: "doc", family: "docs", href: (id) => `/docs/${id}` },
  sop: { glyph: "sop", family: "sops", href: (id) => `/sops/${id}` },
  // /process-runs is a LIST page with no per-run route: (dashboard)/process-runs
  // holds layout.tsx and page.tsx and no [id] segment, so `/process-runs/<id>`
  // renders the in-shell 404. Per this file's own rule a family with no page of
  // its own gets href: null rather than a chip that is guaranteed to miss. The
  // run is still reachable: the list page is a Docs sidebar row and shows every
  // run in the workspace.
  process_run: { glyph: "sop", family: "sops", href: null },
  policy: { glyph: "sop", family: "sops", href: (id) => `/policies/${id}` },
  whiteboard: { glyph: "canvas", family: "docs", href: (id) => `/canvas/${id}` },
  file: { glyph: "file", family: "docs", href: null },
  data_table: { glyph: "table", family: "docs", href: (id) => `/tables/${id}` },
  table: { glyph: "table", family: "docs", href: (id) => `/tables/${id}` },
  form_definition: { glyph: "form", family: "docs", href: (id) => `/forms/${id}` },
  announcement: { glyph: "doc", family: "docs", href: null },
  // Alignment
  okr: { glyph: "goal", family: "goals", href: (id) => `/okrs/${id}` },
  kra: { glyph: "goal", family: "goals", href: (id) => `/kra-kpi?kra=${id}` },
  kpi: { glyph: "goal", family: "goals", href: (id) => `/kra-kpi?kpi=${id}` },
  ownership_area: { glyph: "goal", family: "goals", href: null },
  // People
  user: { glyph: "person", family: "people", href: (id) => `/people/${id}` },
  invitation: { glyph: "person", family: "people", href: null },
  review_cycle: { glyph: "person", family: "people", href: (id) => `/reviews/${id}` },
  talent_assessment: { glyph: "person", family: "people", href: null },
  timesheet: { glyph: "person", family: "people", href: null },
  asset: { glyph: "person", family: "people", href: null },
  meeting: { glyph: "person", family: "people", href: null },
  office: { glyph: "person", family: "people", href: null },
  tool: { glyph: "person", family: "people", href: null },
  kudos: { glyph: "kudos", family: "kudos", href: () => "/kudos" },
  // Workspace and settings. An organization has no page of its own: the
  // settings pages are its surfaces, and a chip that jumped into Settings from
  // an activity row would be a surprise, so it renders as plain text.
  organization: { glyph: "settings", family: "settings", href: null },
  api_key: { glyph: "settings", family: "settings", href: null },
  scim_token: { glyph: "settings", family: "settings", href: null },
  identity_provider: { glyph: "settings", family: "settings", href: null },
  webhook_subscription: { glyph: "settings", family: "settings", href: null },
  workflow: { glyph: "settings", family: "settings", href: (id) => `/automation/workflows/${id}` },
  export: { glyph: "settings", family: "settings", href: null },
  appsumo_code: { glyph: "settings", family: "settings", href: null },
  // Finance
  invoice: { glyph: "finance", family: "finance", href: null },
  purchase_order: { glyph: "finance", family: "finance", href: null },
  budget_plan: { glyph: "finance", family: "finance", href: null },
  gl_account: { glyph: "finance", family: "finance", href: null },
  journal_entry: { glyph: "finance", family: "finance", href: null },
  vendor: { glyph: "finance", family: "finance", href: null },
  fiscal_year: { glyph: "finance", family: "finance", href: null },
  accounting_period: { glyph: "finance", family: "finance", href: null },
};

/** A row nobody wrote a mapping for still renders, as a neutral dot chip. */
export const FALLBACK_TARGET: TargetDef = { glyph: "dot", family: "other", href: null };

export function targetFor(rawType: string | null | undefined): TargetDef {
  return TARGETS[normaliseTargetType(rawType)] ?? FALLBACK_TARGET;
}

/**
 * The chip's href, or null.
 *
 * Null when the family has no page, when there is no id, and when the viewer
 * can no longer read it: a link that 404s is worse than plain text, which is
 * why `readable` is a parameter and not an assumption.
 */
export function targetHref(rawType: string | null | undefined, id: string | null | undefined, readable = true): string | null {
  if (!id || !readable) return null;
  const def = targetFor(rawType);
  return def.href ? def.href(id) : null;
}

export function familyFor(rawType: string | null | undefined): ActivityFamily {
  return targetFor(rawType).family;
}

/** Every family that has at least one row, for GET /api/activity/types. */
export function familiesOf(rawTypes: readonly (string | null)[]): ActivityFamily[] {
  const seen = new Set<ActivityFamily>();
  for (const t of rawTypes) seen.add(familyFor(t));
  const order: ActivityFamily[] = ["tasks", "containers", "docs", "sops", "goals", "people", "kudos", "finance", "settings", "other"];
  return order.filter((f) => seen.has(f));
}

/** The stored `targetType` strings a family covers, for the query filter. */
export function typesInFamily(family: ActivityFamily, rawTypes: readonly (string | null)[]): string[] {
  return [...new Set(rawTypes.filter((t): t is string => Boolean(t) && familyFor(t) === family))];
}

/* ───────────────────────── the sentence ───────────────────────── */

/**
 * The verb, in user words, from the `type` the app wrote.
 *
 * Types are written as `okr_created`, `kra.create`, `review_cycle.create`,
 * `task_created`, `login`, `policy.publish`, `user_removed` and so on: a noun
 * and a verb in either order, joined by a dot or an underscore. The old page
 * inferred a COLOUR by substring-matching the string and printed the raw
 * `description` beside it; this returns the word a person would say.
 */
export function verbFor(type: string | null | undefined): string {
  const t = normaliseTargetType(type).replace(/\./g, "_");
  if (!t) return "did something";
  if (t === "login") return "signed in";
  if (t === "logout") return "signed out";
  const tail = t.split("_").pop() ?? t;
  const VERBS: Record<string, string> = {
    create: "created",
    created: "created",
    update: "updated",
    updated: "updated",
    edit: "edited",
    edited: "edited",
    delete: "deleted",
    deleted: "deleted",
    remove: "removed",
    removed: "removed",
    archive: "archived",
    archived: "archived",
    restore: "restored",
    restored: "restored",
    publish: "published",
    published: "published",
    complete: "completed",
    completed: "completed",
    comment: "commented on",
    commented: "commented on",
    assign: "assigned",
    assigned: "assigned",
    move: "moved",
    moved: "moved",
    rename: "renamed",
    renamed: "renamed",
    share: "shared",
    shared: "shared",
    invite: "invited",
    invited: "invited",
    in: "signed in",
    ack: "acknowledged",
    acknowledged: "acknowledged",
  };
  return VERBS[tail] ?? tail.replace(/_/g, " ");
}

/**
 * Em dashes and double hyphens out of a sentence a person reads (canon H.10).
 *
 * These descriptions are written by the PRODUCT, not by a person, so this is
 * not editing somebody's prose: it is the same rule the writers follow, held
 * at the point of reading as well, because rows written before a writer was
 * corrected are still in the database and still on this page. The writer that
 * produced today's four is fixed too (api/workspace-templates/apply).
 */
function noDashes(text: string): string {
  return text.replace(/\s*[–—]\s*/g, ", ").replace(/\s+--\s+/g, ", ");
}

/**
 * A stored description with the row's own verb removed from the front, or
 * null when nothing is left to say.
 *
 * Matching is done on a normalised form so "Signed in", "signed  in" and
 * "Signed-in" are all the same word to it, and the separator that follows the
 * verb (a space, a colon, a comma, a dash) is eaten with it.
 */
export function withoutLeadingVerb(description: string | null, verb: string): string | null {
  const text = noDashes(description?.trim() ?? "");
  if (!text) return null;
  const flat = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, " ").trim();
  const head = flat(verb);
  if (!head) return text;
  const body = flat(text);
  if (body === head) return null;
  if (!body.startsWith(`${head} `)) return text;
  // Walk the ORIGINAL string by the same number of words the verb has, so the
  // remainder keeps its real spacing and punctuation.
  const words = head.split(" ").length;
  const rest = text.split(/\s+/).slice(words).join(" ").replace(/^[:,\-–—\s]+/, "");
  return rest || null;
}
