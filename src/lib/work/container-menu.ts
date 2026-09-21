// The one "…" menu for a Space, a Folder and a List, as data.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 ("The '…' menus,
// item by item") and section 3 (`ContainerMenu` replaces `space-more-menu.tsx`,
// `folder-more-menu.tsx` and `board-more-menu.tsx`).
//
// WHY THE ROWS ARE DATA. Three menus drifted into three different answers to
// the same question: the List menu had "List info" (a toast) where the Folder
// menu had nothing and the Space menu had "Space settings" (a navigation to the
// page you were already on); Share was a real dialog on a Space, a toast on a
// List row and absent on a Folder. Keeping the rows in a pure table means the
// three kinds can be diffed by reading one file, and a test can assert that
// every row a spec lists is present and that nothing destructive outranks it.
//
// WHAT A ROLE DOES AND DOES NOT DO HERE. `role` hides rows the viewer could
// not use; it never DISABLES one (the access model's read-only rule).
//
// THE DEFAULT IS "view", AND THAT IS THE WHOLE POINT. It was "full" so that a
// host which had not worked out the viewer's object role still rendered every
// row. Three of the five hosts never worked it out, so a Can view member was
// offered Rename, Move, Duplicate, Archive and a red Delete on a Space they
// cannot rename, and every one of those rows answered 403. Offering a row that
// cannot work is the read-only rule inverted. The default now errs the other
// way: a host that passes no role gets the reader's menu, and a host that knows
// better says so. Every host in this repo passes one.
//
// Pure module: no React, no imports, so vitest loads it in node.

export type ContainerKind = "space" | "folder" | "list";

/** Object roles, access-model-spec section 3. */
export type ContainerRole = "full" | "edit" | "comment" | "view";

export type ContainerAction =
  | "favorite"
  | "new"
  | "rename"
  | "copy-link"
  | "color"
  | "pin-top"
  | "share"
  | "features"
  | "statuses"
  | "fields"
  | "default-type"
  | "about"
  | "templates"
  | "automations"
  | "mute"
  | "hide"
  | "move"
  | "duplicate"
  | "archive"
  | "delete";

export interface ContainerMenuRow {
  kind: "row";
  action: ContainerAction;
  /** The label as it reads for THIS viewer (Share vs Who has access, etc.). */
  label: string;
  /** Opens a submenu rather than acting immediately. */
  submenu?: boolean;
  destructive?: boolean;
}

export interface ContainerMenuSeparator {
  kind: "separator";
}

export type ContainerMenuEntry = ContainerMenuRow | ContainerMenuSeparator;

export interface ContainerMenuInput {
  kind: ContainerKind;
  /** Defaults to "view": an unknown role renders the reader's menu, never more. */
  role?: ContainerRole;
  /** Already a favorite, so the row reads "Remove from favorites". */
  isFavorite?: boolean;
  /** Already pinned to the bar's Top strip, so the row reads "Unpin from top". */
  isTopPinned?: boolean;
  /**
   * Org toggle 8 ("people below Admin may delete"). When false the Delete row
   * is absent and Archive is the destructive floor.
   */
  canDelete?: boolean;
  /** Agents never delete and never share (access model section 9). */
  isAgent?: boolean;
  /**
   * Toggle 4: Can edit holders may also share. Without it, a viewer below Full
   * access sees "Who has access" instead of "Share".
   */
  editorsCanShare?: boolean;
}

const RANK: Record<ContainerRole, number> = { view: 0, comment: 1, edit: 2, full: 3 };

/** True when `role` is at least `floor`. */
export function roleAtLeast(role: ContainerRole, floor: ContainerRole): boolean {
  return RANK[role] >= RANK[floor];
}

function row(
  action: ContainerAction,
  label: string,
  extra: Omit<ContainerMenuRow, "kind" | "action" | "label"> = {},
): ContainerMenuRow {
  return { kind: "row", action, label, ...extra };
}

const SEP: ContainerMenuSeparator = { kind: "separator" };

/**
 * The rows for one container, in spec order.
 *
 * Separators are emitted optimistically and then collapsed, so a role that
 * removes a whole block never leaves a rule with nothing under it.
 */
export function containerMenuRows(input: ContainerMenuInput): ContainerMenuEntry[] {
  const {
    kind,
    role = "view",
    isFavorite = false,
    isTopPinned = false,
    canDelete = true,
    isAgent = false,
    editorsCanShare = false,
  } = input;

  const full = role === "full";
  const canEdit = roleAtLeast(role, "edit");
  const shareIsWrite = full || (canEdit && editorsCanShare);
  const out: ContainerMenuEntry[] = [];

  out.push(row("favorite", isFavorite ? "Remove from favorites" : "Add to favorites"));
  // ClickUp's Favorite > Top: a chip row under the bar (top-pins-strip.tsx).
  out.push(row("pin-top", isTopPinned ? "Unpin from top" : "Pin to top"));

  // A List has no children to create, so its New submenu does not exist.
  if (kind !== "list" && canEdit) out.push(row("new", "New", { submenu: true }));

  out.push(SEP);

  if (full) out.push(row("rename", "Rename"));
  out.push(row("copy-link", "Copy link"));
  if (full) out.push(row("color", "Color & icon", { submenu: true }));

  out.push(SEP);

  if (!isAgent) out.push(row("share", shareIsWrite ? "Share" : "Who has access"));

  // Spec row 9 is "Settings -> /spaces/[slug]?tab=settings". That tab is not
  // built, and the row this replaced pushed `/spaces/[slug]`: from the Space
  // page's own title row that is the page you are already on, so the menu
  // closed and nothing happened. A row that navigates nowhere is worse than no
  // row, and nothing is lost: /spaces/[slug] is the Space you just clicked.
  // What the row uniquely reached is Features (the modules modal), which keeps
  // its own row until the Settings tab exists to hold it.
  if (kind === "space" && full) out.push(row("features", "Features"));

  if (kind === "list") {
    if (full) {
      out.push(row("statuses", "Statuses"));
      out.push(row("fields", "Fields"));
      out.push(row("default-type", "Default task type", { submenu: true }));
    }
    out.push(row("about", "About"));
  }
  if (kind === "folder") out.push(row("about", "About"));

  if (full) out.push(row("templates", "Templates", { submenu: true }));
  if (canEdit) out.push(row("automations", "Automations…"));
  if (kind !== "folder") out.push(row("mute", "Mute notifications"));

  out.push(SEP);

  if (kind === "space") out.push(row("hide", "Hide from sidebar"));
  if (full) {
    out.push(row("move", "Move"));
    out.push(row("duplicate", "Duplicate"));
    out.push(row("archive", "Archive"));
    if (canDelete && !isAgent) out.push(row("delete", "Delete", { destructive: true }));
  }

  return collapseSeparators(out);
}

/** Drop leading, trailing and doubled separators. */
export function collapseSeparators(entries: ContainerMenuEntry[]): ContainerMenuEntry[] {
  const out: ContainerMenuEntry[] = [];
  for (const e of entries) {
    if (e.kind === "separator") {
      if (out.length === 0) continue;
      if (out[out.length - 1].kind === "separator") continue;
    }
    out.push(e);
  }
  while (out.length > 0 && out[out.length - 1].kind === "separator") out.pop();
  return out;
}

// ── Deriving the role a host must pass ─────────────────────────────
//
// The sidebar tree renders dozens of containers per expand, so it cannot call
// `canEditSpace` / `canEditBoard` once per row: each of those loads its own
// facts. These two functions read the membership rows the listing queries
// already select, and they are deliberately CONSERVATIVE where the async
// helpers are subtle (a PRIVATE List reachable only because the viewer owns the
// Space resolves to "edit" here, not "full"): a row that is absent costs a trip
// to the object's own page, a row that is present costs a 403.

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

/**
 * A Space's (and therefore its Folders') role, mirroring `canEditSpace`
 * (org admin / OWNER / ADMIN) and `canContributeSpace` (any non-GUEST member).
 */
export function spaceContainerRole(input: {
  isOrgAdmin: boolean;
  memberRole?: MembershipRole | string | null;
}): ContainerRole {
  if (input.isOrgAdmin) return "full";
  const role = input.memberRole ?? null;
  if (role === "OWNER" || role === "ADMIN") return "full";
  if (role && role !== "GUEST") return "edit";
  return "view";
}

/**
 * A List's role. A PRIVATE List answers only to its own grants and its owner;
 * any other List inherits the Space, which is what `canEditBoard` does when it
 * falls through to `canEditSpace`.
 */
export function listContainerRole(input: {
  isOrgAdmin: boolean;
  spaceRole: ContainerRole;
  visibility?: string | null;
  isOwner?: boolean;
  memberRole?: MembershipRole | string | null;
}): ContainerRole {
  if (input.isOrgAdmin || input.isOwner) return "full";
  const role = input.memberRole ?? null;
  if (role === "OWNER" || role === "ADMIN") return "full";
  const inherits = input.visibility !== "PRIVATE";
  if (inherits && input.spaceRole === "full") return "full";
  if (role && role !== "GUEST") return "edit";
  if (inherits && input.spaceRole === "edit") return "edit";
  return "view";
}

export interface ContainerRef {
  kind: ContainerKind;
  id: string;
  /** Spaces and Lists are slug routes; a Folder is addressed by id. */
  slug?: string | null;
}

/**
 * The path a container's Copy link writes.
 *
 * audit spaces-boards High #1: the List menu copied `/boards/<id>` on a route
 * that resolves a slug and `notFound()`s on an id, so every pasted List link
 * was a 404. A List without a slug is the only case that has no path, and the
 * caller says so rather than copying a broken one.
 */
export function containerPath(ref: ContainerRef): string | null {
  if (ref.kind === "folder") return `/folders/${ref.id}`;
  if (!ref.slug) return null;
  return ref.kind === "space" ? `/spaces/${ref.slug}` : `/boards/${ref.slug}`;
}

/** The noun the confirms and toasts use. Never "board", never "item". */
export function containerNoun(kind: ContainerKind): string {
  return kind === "space" ? "Space" : kind === "folder" ? "Folder" : "List";
}
