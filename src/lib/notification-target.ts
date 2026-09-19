// notification-target.ts — what a notification points at, read out of the one
// column it has.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox, "Detail
// pane"), which asks the pane to render the task itself, or a mention excerpt,
// or a summary card, and asks the SERVER to decide whether the viewer can open
// the target: `target: { readable: false, reason: "deleted" | "no_access" |
// "moved" }`.
//
// WHY THIS IS A PARSER AND NOT A COLUMN. `Notification` has `title`, `message`,
// `type` and a free-text `link`, and nothing else: no `entityType`, no
// `entityId`, no `actorId`, no `organizationId`. Adding those is a schema
// change with a backfill over every row anyone has ever received, and it would
// still leave the existing rows resolvable only through `link`. So the link IS
// the reference, and this module is the one place that reads it. When the
// columns are added later, `parseNotificationLink` becomes the fallback for
// rows written before them rather than being deleted.
//
// It is deliberately conservative: an unrecognised link is `{ kind: "external"
// }` with the href intact, which renders a summary card and a working Open
// button. Nothing here guesses.
//
// NO IMPORTS: the API route and the client both read this.

export type TargetKind =
  | "item"
  | "board"
  | "space"
  | "folder"
  | "doc"
  | "sop"
  | "okr"
  | "kra"
  | "person"
  | "kudos"
  | "survey"
  | "review"
  | "policy"
  | "meeting"
  | "talk"
  | "external"
  | "none";

export interface NotificationTarget {
  kind: TargetKind;
  /** The object's id, when the link named one. */
  id: string | null;
  /** The href to navigate to, normalised. Null when the link was empty. */
  href: string | null;
  /** A `#b-<id>` block anchor or a `#c-<id>` comment anchor, without the hash. */
  anchor: string | null;
  /** True when `anchor` names a comment (`#c-…`), so the pane can scroll to it. */
  anchorIsComment: boolean;
}

const EMPTY: NotificationTarget = { kind: "none", id: null, href: null, anchor: null, anchorIsComment: false };

/**
 * Route prefixes, longest first so `/kra-kpi` never loses to `/kra`. The value
 * is the kind and whether the segment after the prefix is the object's id.
 */
const ROUTES: ReadonlyArray<{ prefix: string; kind: TargetKind; idFollows: boolean }> = [
  { prefix: "/item", kind: "item", idFollows: true },
  { prefix: "/boards", kind: "board", idFollows: true },
  { prefix: "/spaces", kind: "space", idFollows: true },
  { prefix: "/folders", kind: "folder", idFollows: true },
  { prefix: "/docs", kind: "doc", idFollows: true },
  { prefix: "/sops", kind: "sop", idFollows: true },
  { prefix: "/okrs", kind: "okr", idFollows: true },
  { prefix: "/kra-kpi", kind: "kra", idFollows: false },
  { prefix: "/people", kind: "person", idFollows: true },
  { prefix: "/kudos", kind: "kudos", idFollows: false },
  { prefix: "/surveys", kind: "survey", idFollows: true },
  { prefix: "/reviews", kind: "review", idFollows: true },
  { prefix: "/policies", kind: "policy", idFollows: true },
  { prefix: "/meetings", kind: "meeting", idFollows: true },
  { prefix: "/tlk", kind: "talk", idFollows: true },
];

const ROUTES_BY_LENGTH = [...ROUTES].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Split a stored `link` into a target. Handles:
 *   "/item/abc"                  -> item abc
 *   "/docs/abc#b-xyz"            -> doc abc, block anchor xyz
 *   "/item/abc?x=1#c-42"         -> item abc, comment anchor 42
 *   "https://app.workwrk.com/…"  -> the path, parsed as above
 *   ""  / null                   -> { kind: "none" }
 *   "/anything-else"             -> external, href preserved
 */
export function parseNotificationLink(link: string | null | undefined): NotificationTarget {
  const raw = (link ?? "").trim();
  if (!raw) return EMPTY;

  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      path = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return { ...EMPTY, kind: "external", href: raw };
    }
  }
  if (!path.startsWith("/")) return { ...EMPTY, kind: "external", href: raw };

  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt + 1) : "";
  const withoutHash = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const queryAt = withoutHash.indexOf("?");
  const pathname = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;

  // Two anchor conventions, both live:
  //   `#b-<blockId>` / `#c-<commentId>`  the doc and SOP mention links
  //   `?comment=<updateId>`              what lib/notify-item.ts and the item
  //                                      comment route write for a task
  // The second one is the one a person actually receives today, so a parser
  // that only knew the first would land every comment notification at the top
  // of the task instead of on the comment it is about.
  const queryComment = readParam(withoutHash, "comment");
  const anchorIsComment = /^c-/.test(hash) || queryComment !== null;
  const anchor = queryComment ?? (/^[bc]-/.test(hash) ? hash.slice(2) : hash || null);

  for (const route of ROUTES_BY_LENGTH) {
    if (pathname !== route.prefix && !pathname.startsWith(`${route.prefix}/`)) continue;
    const rest = pathname.slice(route.prefix.length).replace(/^\//, "");
    const id = route.idFollows && rest ? rest.split("/")[0] : null;
    return { kind: route.kind, id, href: path, anchor, anchorIsComment };
  }

  return { kind: "external", id: null, href: path, anchor, anchorIsComment };
}

/** One query parameter out of a path, without needing a base URL. */
function readParam(pathWithQuery: string, name: string): string | null {
  const at = pathWithQuery.indexOf("?");
  if (at < 0) return null;
  for (const pair of pathWithQuery.slice(at + 1).split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq) === name) {
      const value = decodeURIComponent(pair.slice(eq + 1));
      return value || null;
    }
  }
  return null;
}

/**
 * The legacy `?item=<id>` form some stored links still carry
 * ("/boards/q4-leads?item=abc"). One task, one URL, so it resolves to the same
 * item target the new links use.
 */
export function resolveLegacyItemParam(link: string | null | undefined): NotificationTarget | null {
  const raw = (link ?? "").trim();
  if (!raw || !raw.includes("item=")) return null;
  const queryAt = raw.indexOf("?");
  if (queryAt < 0) return null;
  const query = raw.slice(queryAt + 1).split("#")[0];
  for (const pair of query.split("&")) {
    const [k, v] = pair.split("=");
    if (k === "item" && v) {
      return { kind: "item", id: decodeURIComponent(v), href: `/item/${decodeURIComponent(v)}`, anchor: null, anchorIsComment: false };
    }
  }
  return null;
}

/** The one call the Inbox and the bell make. Legacy form first, then the path. */
export function notificationTarget(link: string | null | undefined): NotificationTarget {
  return resolveLegacyItemParam(link) ?? parseNotificationLink(link);
}

/** Why the viewer cannot open a target. The pane prints one of three sentences. */
export type UnreadableReason = "deleted" | "no_access" | "moved";

export const UNREADABLE_SENTENCE: Readonly<Record<UnreadableReason, string>> = {
  deleted: "This was deleted",
  no_access: "You no longer have access to this",
  moved: "This was moved somewhere you can't see",
};

/** The word an "Open" button uses for a kind: "Open task", "Open doc". */
export const TARGET_NOUN: Readonly<Record<TargetKind, string>> = {
  item: "task",
  board: "List",
  space: "Space",
  folder: "folder",
  doc: "doc",
  sop: "SOP",
  okr: "goal",
  kra: "KRA",
  person: "profile",
  kudos: "kudos",
  survey: "survey",
  review: "review",
  policy: "policy",
  meeting: "meeting",
  talk: "conversation",
  external: "",
  none: "",
};
