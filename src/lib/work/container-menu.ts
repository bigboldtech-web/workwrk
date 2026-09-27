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
// better says so. Every host in this repo passes one. A null role (the Work
// tree's server-decided role, absent for a row it did not decide) reads the
// same way.
//
// ONE ACCESS ROW, "Manage access" OR "Who has access". It was "Share", and a
// Can edit holder read "Share" under toggle 4. A person grant now needs Full
// access on the node itself (roles never climb), so offering the write label
// to anyone below Full would open a dialog whose every control answers 403.
// `editorsCanShare` stays on the input type so no host breaks, and is ignored.
//
// A PATH CONTAINER (decision A3) is a Space or Folder the viewer sees only as
// the named way to something shared with them. They hold no role on it, so the
// menu is exactly Copy link, whatever role a host passes.
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
  | "manage-access"
  | "features"
  | "statuses"
  | "fields"
  | "default-type"
  | "default-values"
  | "row-colors"
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
  /** The label as it reads for THIS viewer (Manage access vs Who has access, etc.). */
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
  /** Defaults to "view": an unknown or null role renders the reader's menu, never more. */
  role?: ContainerRole | null;
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
   * Kept so no host breaks, and IGNORED: the access row reads "Manage access"
   * only at Full access, because a person grant needs Full on the node.
   */
  editorsCanShare?: boolean;
  /**
   * The viewer reaches this container only as the path to something shared
   * with them inside it (decision A3). The menu is exactly Copy link.
   */
  pathOnly?: boolean;
}

const RANK: Record<ContainerRole, number> = { view: 0, comment: 1, edit: 2, full: 3 };

/** True when `role` is at least `floor`. */
export function roleAtLeast(role: ContainerRole, floor: ContainerRole): boolean {
  return RANK[role] >= RANK[floor];
}

/** What the "New" menus make inside a container. */
export type NewItem = "list" | "sprint" | "folder" | "doc" | "canvas" | "table";

/**
 * What this viewer can make inside this container: the one create rule
 * (node-rules P1, createDecision) as the menus read it, so a menu offers
 * exactly what the server accepts. Can edit or higher makes every kind a
 * container holds (a Sprint is a List); Can view and Can comment make
 * nothing; a table sits only at a Space's root; a List holds no children,
 * and a path container gives no role to make anything with.
 * container-menu.placement.test.ts proves it matches createDecision.
 */
export function newItemsFor(kind: ContainerKind, role: ContainerRole | null | undefined, pathOnly = false): NewItem[] {
  if (pathOnly || kind === "list" || !roleAtLeast(role ?? "view", "edit")) return [];
  return kind === "space" ? ["list", "sprint", "folder", "doc", "canvas", "table"] : ["list", "sprint", "folder", "doc", "canvas"];
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
    isFavorite = false,
    isTopPinned = false,
    canDelete = true,
    isAgent = false,
    pathOnly = false,
  } = input;
  const role: ContainerRole = input.role ?? "view";

  // A path container names the way to a shared item and nothing else: no
  // favourite (the item is the thing to star), no New, no access list (its
  // members are not the viewer's to read), no destructive row.
  if (pathOnly) return [row("copy-link", "Copy link")];

  const full = role === "full";
  const canEdit = roleAtLeast(role, "edit");
  const out: ContainerMenuEntry[] = [];

  out.push(row("favorite", isFavorite ? "Remove from favorites" : "Add to favorites"));
  // ClickUp's Favorite > Top: a chip row under the bar (top-pins-strip.tsx).
  out.push(row("pin-top", isTopPinned ? "Unpin from top" : "Pin to top"));

  // The New submenu exists when the one create rule gives this viewer
  // something to make here (newItemsFor). A List has no children to create.
  if (newItemsFor(kind, role).length > 0) out.push(row("new", "New", { submenu: true }));

  out.push(SEP);

  if (full) out.push(row("rename", "Rename"));
  out.push(row("copy-link", "Copy link"));
  if (full) out.push(row("color", "Color & icon", { submenu: true }));

  out.push(SEP);

  if (!isAgent) out.push(row("manage-access", full ? "Manage access" : "Who has access"));

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
      // Phase 5b, List comfort (gap 14): what a new task starts with, and
      // which rows are coloured by which rule. Both write Board.settings, the
      // same Full-access door as the rows above.
      out.push(row("default-values", "Default values"));
      out.push(row("row-colors", "Conditional colors"));
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
