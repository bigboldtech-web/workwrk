// retired-views.ts — the query-parameter half of the Phase 3 redirect table.
//
// Spec: docs/plans/ui-refresh/spec-docs-knowledge.md section 0 (`/docs?view=
// meeting`, `/docs?view=private`) and the `/notetaker?mine=1` row.
//
// WHY THESE THREE ARE NOT IN next.config.ts. Next appends the source URL's
// query string to the destination on every redirect, including the parameter
// the `has` clause matched. Every other row in the Phase 3 table changes the
// path, so the ride-along is inert. These three do not: `/docs?view=meeting`
// would redirect to `/docs?view=meeting`, match its own rule again, and loop
// until the browser stopped it. So they are normalised on the page, with one
// `router.replace` on mount, which leaves the URL linkable and restorable and
// cannot loop because the replaced URL no longer matches.
//
// WHY EACH ONE IS RETIRED (the audit's own words, so the table is auditable):
//   /docs?view=meeting  "Meeting Notes" was a TITLE REGEX over doc titles
//                       (/meeting|minutes|stand.?up|1:1/i). A meeting note is
//                       a template, not a view, so the view is dropped and
//                       the rows are simply All docs.
//   /docs?view=private  "Private" meant "created by me AND not anchored",
//                       which the Location filter answers. Its nearest honest
//                       view is Mine.
//   /notetaker?mine=1   the page never read the parameter, so the "My Clips"
//                       row was a second door to the same list. The Recent
//                       card now carries All / Mine and reads ?view=my
//                       (Mine = meeting notes the viewer attends), so the old
//                       link lands on the list it always named.
//   /forms?mine=1       the deleted FormsSidebar "My Forms" row (Phase 5). The
//                       /forms page reads ?view=mine, so a stored link lands
//                       on Mine instead of All.
//
// Pure: no React, no next/navigation. Every rule below is unit-tested.

export interface RetiredViewRule {
  /** The pathname the rule applies to, matched exactly. */
  path: string;
  /** The query key that carries the retired value. */
  key: string;
  /** The retired value, matched case-insensitively. */
  from: string;
  /**
   * What the parameter becomes. `null` removes it, which is how
   * `/docs?view=meeting` lands on plain `/docs`.
   */
  to: { key: string; value: string } | null;
}

export const RETIRED_VIEWS: readonly RetiredViewRule[] = [
  { path: "/docs", key: "view", from: "meeting", to: null },
  { path: "/docs", key: "view", from: "private", to: { key: "view", value: "my" } },
  { path: "/notetaker", key: "mine", from: "1", to: { key: "view", value: "my" } },
  { path: "/forms", key: "mine", from: "1", to: { key: "view", value: "mine" } },
];

/**
 * The URL a retired view should become, or `null` when nothing is retired.
 *
 * Returning `null` rather than the same URL is deliberate: the caller uses it
 * as the "do not touch the URL" answer, so a page that calls this on every
 * render replaces at most once and never fights the router.
 *
 * Every OTHER parameter is carried across untouched, so a filter or a search
 * term on a retired link survives the normalisation.
 */
export function normaliseRetiredView(pathname: string, search: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  let changed = false;

  for (const rule of RETIRED_VIEWS) {
    if (rule.path !== path) continue;
    const value = params.get(rule.key);
    if (value === null || value.toLowerCase() !== rule.from) continue;
    params.delete(rule.key);
    if (rule.to) params.set(rule.to.key, rule.to.value);
    changed = true;
  }

  if (!changed) return null;
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// ── The two "new" URLs that were used to EDIT ─────────────────────
//
// spec-process section 0: `/sops/new/text?id=X` and `/sops/new/checklist?id=X`
// 308 to `/sops/X?edit=1`. A "new" URL was the only door to editing a Written
// or Checklist SOP (knowledge 1.12, 1.13); every kind edits on the SOP page
// now, and the two create doors mint a row and land there.
//
// next.config.ts carries the real 308 (named capture `(?<id>…)` in the `has`
// value, which Next reads into the destination). This is the page-level twin
// for the same reason `/docs/trash` has a route-handler twin: a config row is
// read once at server start, so the page normalises the URL as well and a
// stored link lands even on a process that predates the config edit.
//
// Pure, and separate from `normaliseRetiredView` because it changes the PATH:
// that function is the same-path table, kept loop-free by construction, and
// mixing a path change into it would break the idempotence test it relies on.

/** The paths whose `?id=` meant "edit this existing SOP". */
export const LEGACY_SOP_EDITOR_PATHS: readonly string[] = ["/sops/new/text", "/sops/new/checklist"];

/** `/sops/X?edit=1` for a legacy editor URL that names an id; `null` otherwise. */
export function legacySopEditorTarget(pathname: string, search: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (!LEGACY_SOP_EDITOR_PATHS.includes(path)) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const id = (params.get("id") ?? "").trim();
  // An id is a cuid; anything else is a malformed link and stays where it is.
  // The create door then shows a broken-link error (`isMalformedLegacySopId`)
  // rather than minting a fresh "Untitled" row nobody asked for.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return `/sops/${encodeURIComponent(id)}?edit=1`;
}

/**
 * True when a legacy editor URL names an `?id=` that is not an id (a mangled
 * bookmark such as `?id=a%20b`). The create door renders an error with a way
 * back for these instead of creating a row: a broken edit link is not a
 * request to make something new.
 */
export function isMalformedLegacySopId(pathname: string, search: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (!LEGACY_SOP_EDITOR_PATHS.includes(path)) return false;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const id = (params.get("id") ?? "").trim();
  return id.length > 0 && legacySopEditorTarget(pathname, search) === null;
}
