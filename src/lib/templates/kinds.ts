// The Template Center's one vocabulary: what a kind is called, what the card
// draws, whether it needs a container before it can be applied, and where the
// person lands afterwards.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/templates).
//
// WHY THIS FILE EXISTS. Before it the kind vocabulary was spread across four
// places that disagreed: the modal's own KIND_LABEL map (seven kinds, no
// Starter kits), the API's KINDS tuple, the apply route's three-branch switch
// that 400d on the other four, and a shell handler that reacted to TASK alone
// and dropped every other kind's result on the floor (audit High #6). A kind is
// now one row here, so a new kind cannot ship half-wired.
//
// Pure: no React, no prisma, no next. The page, the modal, the apply route and
// the tests all read the same table.

/** The seven stored `TemplateKind` values, plus the one pseudo-kind. */
export type TemplateKind = "TASK" | "LIST" | "SPACE" | "FOLDER" | "DOC" | "VIEW" | "WHITEBOARD";

/**
 * "Starter kits" is not a `TemplateKind` row: it is the legacy workspace
 * bundle (`/api/workspace-templates`), which seeds a Doc, a Form and a Table
 * at once. The legacy `/templates` page was its only door and that page is
 * gone, so the kit becomes a kind on this page rather than a destination that
 * disappears.
 */
export type TemplateKindKey = TemplateKind | "KIT";

/** The line drawing a card of this kind shows: never one glyph for all eight. */
export type TemplateArt = "dot" | "row" | "grid" | "page" | "cluster" | "shelf" | "column" | "kit";

/** What a kind needs before it can be applied. */
export type TemplateTarget = "none" | "space" | "space-or-folder" | "list";

export interface TemplateKindDef {
  key: TemplateKindKey;
  /** The pill and chip word, singular. */
  label: string;
  /** The views-row pill, plural. */
  plural: string;
  art: TemplateArt;
  /** The container the apply needs; "none" applies straight away. */
  target: TemplateTarget;
  /** One sentence for the kind's own empty state. */
  emptyHint: string;
}

/**
 * EVERY HINT NAMES A MENU THAT EXISTS.
 *
 * Five of these used to point at a control nobody had built: there is no "Save
 * as template" row on a Doc, on a saved View or on a Canvas anywhere in the
 * product, so "Save one from a doc's … menu." sent the reader looking for
 * something that is not there. The four kinds that CAN be saved today (Task,
 * List, Folder, Space) name their real menu; the three that cannot say what
 * they are and where they come from instead of inventing an instruction.
 * When a Doc, View or Canvas gains the row, its hint changes with it.
 */
export const TEMPLATE_KINDS: readonly TemplateKindDef[] = [
  { key: "TASK", label: "Task", plural: "Tasks", art: "dot", target: "none", emptyHint: "Save one from a task's … menu, or from the create-task modal." },
  { key: "LIST", label: "List", plural: "Lists", art: "row", target: "space-or-folder", emptyHint: "Save one from a list's … menu." },
  { key: "FOLDER", label: "Folder", plural: "Folders", art: "shelf", target: "space", emptyHint: "Save one from a folder's … menu." },
  { key: "SPACE", label: "Space", plural: "Spaces", art: "grid", target: "none", emptyHint: "Save one from a Space's … menu." },
  { key: "DOC", label: "Doc", plural: "Docs", art: "page", target: "space", emptyHint: "Save one from a doc's … menu." },
  { key: "VIEW", label: "View", plural: "Views", art: "column", target: "list", emptyHint: "View templates ship with the product; saving your own is not built yet." },
  { key: "WHITEBOARD", label: "Canvas", plural: "Canvases", art: "cluster", target: "space", emptyHint: "Save one from a canvas's … menu." },
  { key: "KIT", label: "Starter kit", plural: "Starter kits", art: "kit", target: "none", emptyHint: "Starter kits ship with the product." },
] as const;

export const TEMPLATE_KIND_BY_KEY: Readonly<Record<TemplateKindKey, TemplateKindDef>> =
  Object.fromEntries(TEMPLATE_KINDS.map((k) => [k.key, k])) as Record<TemplateKindKey, TemplateKindDef>;

/** The seven that are real `TemplateKind` rows in the database. */
export const STORED_TEMPLATE_KINDS: readonly TemplateKind[] = TEMPLATE_KINDS
  .filter((k): k is TemplateKindDef & { key: TemplateKind } => k.key !== "KIT")
  .map((k) => k.key);

export function isStoredKind(value: string): value is TemplateKind {
  return (STORED_TEMPLATE_KINDS as readonly string[]).includes(value);
}

/**
 * The `?kind=` parameter, which is lower case in every link the product writes
 * ("/templates?kind=doc", "/templates?kind=task"), resolved to a kind key.
 * Returns null for "all", an empty value and anything unknown, so an unknown
 * value shows everything rather than an empty page.
 */
export function kindFromParam(raw: string | null | undefined): TemplateKindKey | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  if (v === "ALL") return null;
  if (v === "CANVAS" || v === "WHITEBOARD") return "WHITEBOARD";
  if (v === "KIT" || v === "KITS" || v === "STARTER" || v === "STARTER_KIT") return "KIT";
  if (v === "BOARD") return "LIST"; // the retired word, so old links still land
  return isStoredKind(v) ? v : null;
}

/** The value a link writes. Lower case, matching every href in the product. */
export function kindParam(key: TemplateKindKey): string {
  return key.toLowerCase();
}

export type TemplateComplexity = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

/**
 * The user's three words for complexity. "Beginner / Intermediate / Advanced"
 * is what the rows store; the spec's Filter panel says Simple / Standard /
 * Advanced, so the mapping lives here and the stored values never move.
 */
export const COMPLEXITY_LABEL: Readonly<Record<TemplateComplexity, string>> = {
  BEGINNER: "Simple",
  INTERMEDIATE: "Standard",
  ADVANCED: "Advanced",
};

export const COMPLEXITIES: readonly TemplateComplexity[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];

/** The result an apply hands back, and where it sends the person. */
export interface AppliedTemplate {
  kind: TemplateKindKey;
  slug?: string | null;
  boardId?: string | null;
  spaceId?: string | null;
  folderId?: string | null;
  docId?: string | null;
  whiteboardId?: string | null;
  viewId?: string | null;
  /** VIEW applies onto a List, so the navigation needs the host List's slug. */
  boardSlug?: string | null;
  /** A Starter kit creates three things and has no single page. */
  created?: Array<{ label: string; href: string }>;
  /** TASK only: the create-task modal's own config shape, so it opens filled. */
  config?: Record<string, unknown>;
  /** The template's name, for the modal's "Applied ..." notice. */
  name?: string | null;
}

/**
 * Where a person lands after applying. `null` means "nothing to navigate to":
 * a TASK opens the create-task modal prefilled and a KIT reports its three
 * links in a toast, because a kit has no page of its own.
 *
 * The shell used to own this decision and knew one kind (audit High #6). It is
 * a pure function of the apply result now, so every kind arrives somewhere.
 */
export function navigationFor(result: AppliedTemplate): string | null {
  switch (result.kind) {
    case "LIST":
      return result.slug ? `/boards/${result.slug}` : null;
    case "SPACE":
      return result.slug ? `/spaces/${result.slug}` : null;
    case "FOLDER":
      return result.folderId ? `/folders/${result.folderId}` : null;
    case "DOC":
      return result.docId ? `/docs/${result.docId}` : null;
    case "WHITEBOARD":
      return result.whiteboardId ? `/canvas/${result.whiteboardId}` : null;
    case "VIEW":
      return result.boardSlug && result.viewId ? `/boards/${result.boardSlug}?view=${result.viewId}` : null;
    case "TASK":
    case "KIT":
    default:
      return null;
  }
}

/** The sentence the toast says after an apply that navigated nowhere. */
export function appliedToast(result: AppliedTemplate): string {
  if (result.kind === "KIT") {
    const names = (result.created ?? []).map((c) => c.label);
    return names.length ? `Created ${names.join(", ")}` : "Starter kit applied";
  }
  if (result.kind === "TASK") return "Template loaded into a new task";
  return "Template applied";
}
