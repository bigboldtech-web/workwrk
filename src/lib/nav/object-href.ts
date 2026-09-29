// Where an object opens: a pure function of the section it is opened from.
//
// THE RULE (founder, 2026-09-24): an item opens in its Space, from every
// section. A Doc, Table, Canvas, Form or SOP followed from Work, Planner,
// Talk, Teams, AI, Home, the Inbox, a notification, search, the palette,
// Everything, an activity feed, a comment or Settings opens at its Work
// address, because "full Docs is the storage we have": people will have
// their Space and their folders, and maybe not the Docs or Tables hub at
// all. The two storage browsers are the one exception. A link clicked
// INSIDE the Docs or Tables hub keeps the canonical form, for the people
// who have those hubs (STORAGE_HUBS, opensInWork).
//
// Every object has three addresses:
//
//   /spaces/{slug}/{seg}/{id}   the Space-scoped Work address of a Doc, Table
//                               or Canvas whose own Space the viewer can see
//                               in the Work tree. `{slug}` is always the
//                               item's OWN Space; it is a hint here and the
//                               route's gate is the authority.
//   /work/{seg}/{id}            the Work door: id only. It places the item
//                               for whoever opens it, under their own access:
//                               at its Space-scoped address when they can see
//                               its path, in place when they cannot. Copy link
//                               gives the door from EVERY hub, the storage
//                               hubs included, so a link sent to someone opens
//                               in the recipient's own Space (shareHref).
//   /{seg}/{id}                 canonical, unchanged and valid forever: the
//                               storage hubs' own address and the form of
//                               every href stored in data. Nothing here
//                               rewrites stored data; a link is mapped as it
//                               is followed (sectionHref).
//
// A person whose rail has no Docs or Tables hub, or who lacks the folded
// Forms or SOPs app, and who lands on a canonical address anyway (an old
// bookmark, a pasted link) is moved to the door (canonicalRedirect, run by
// src/components/access/canonical-hub-gate.tsx). Work addresses never send
// anyone to a canonical one, so the two can never bounce.
//
// Every URL of all three forms resolves to its hub through ROUTE_HUB alone
// ("/spaces" and "/work" are Work rows, "/docs" and friends are not), so the
// rail, the sidebar and the crumb need nothing new.
//
// This file imports only "./route-hub" and nothing through the "@/" alias,
// so its test stays node-only like route-hub.test.ts.

import { resolveHub, type HubKey } from "./route-hub";

/** The five kinds of object that open in an editor and can be linked to. */
export type ObjectKind = "doc" | "table" | "canvas" | "sop" | "form";

/** Each kind's URL segment. Work addresses mirror the canonical ones, so an address stays readable. */
export const OBJECT_SEGMENT: Readonly<Record<ObjectKind, string>> = {
  doc: "docs",
  table: "tables",
  canvas: "canvas",
  sop: "sops",
  form: "forms",
};

/**
 * The kinds with a row in the Work tree, and so a Space-scoped address. SOPs
 * and forms get the Work door only: neither has a tree row to light, and
 * neither is governed by Space rules (the SOP centre has its own folder
 * grants, a form its own Guest rule).
 */
export const SPACE_SCOPED: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["doc", "table", "canvas"]);

/** The Work door's first segment, owned by ROUTE_HUB's "/work" row. */
export const WORK_DOOR_SEGMENT = "work";

/**
 * The two storage browsers. A link clicked inside one of them keeps the
 * canonical form, so browsing the store stays in the store; every other
 * hub opens objects in Work.
 */
export const STORAGE_HUBS: ReadonlySet<HubKey> = new Set<HubKey>(["docs", "tables"]);

/** Whether a link followed from this hub opens at a Work address. */
export function opensInWork(from: HubKey): boolean {
  return !STORAGE_HUBS.has(from);
}

/**
 * The storage hub whose browser owns each kind's canonical address. It is
 * what ROUTE_HUB says for /{seg}, pinned by a test.
 */
export const CANONICAL_HUB: Readonly<Record<ObjectKind, HubKey>> = {
  doc: "docs",
  canvas: "docs",
  sop: "docs",
  table: "tables",
  form: "tables",
};

/**
 * The folded app (route-hub.ts FOLDED_APP_HUB) a kind's canonical address
 * needs as well as its hub: an org can switch Forms or SOPs off, or floor
 * them, while their hub stays on the rail.
 */
export const CANONICAL_APP: Readonly<Partial<Record<ObjectKind, string>>> = {
  sop: "sops",
  form: "forms",
};

const ALL_KINDS: readonly ObjectKind[] = ["doc", "table", "canvas", "sop", "form"];

// Static children that share an object segment, so a path like /sops/new is
// never read as the SOP with id "new". /docs/trash is a redirect route.
const RESERVED: Readonly<Partial<Record<ObjectKind, ReadonlySet<string>>>> = {
  doc: new Set(["trash"]),
  sop: new Set(["new", "my-sops", "compliance", "manage"]),
};

const KIND_BY_SEGMENT: ReadonlyMap<string, ObjectKind> = new Map(
  (Object.entries(OBJECT_SEGMENT) as [ObjectKind, string][]).map(([kind, seg]) => [seg, kind]),
);

/** The address a Work route represents: Space-scoped under a slug, or the door. */
export type WorkAt = { scope: "space"; slug: string } | { scope: "work" };

/** What `openedObject` reads out of a path. */
export interface OpenedObject {
  kind: ObjectKind;
  id: string;
  scope: "canonical" | "space" | "work";
  /** The slug a Space-scoped address carries; null for the other two forms. */
  spaceSlug: string | null;
}

/**
 * The object mounted in the main area and the address it is mounted at.
 * `self` is where a link to that same object must go, so following it never
 * unmounts and remounts the editor.
 */
export interface OpenObjectRef {
  kind: ObjectKind;
  id: string;
  self: string;
}

const enc = (s: string) => encodeURIComponent(s);

function dec(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Today's URL for an object: the one its own hub opens. */
export function canonicalHref(kind: ObjectKind, id: string): string {
  return `/${OBJECT_SEGMENT[kind]}/${enc(id)}`;
}

/** The address a Work route stands for, rebuilt from its own params. */
export function addressHref(kind: ObjectKind, id: string, at: WorkAt): string {
  const seg = OBJECT_SEGMENT[kind];
  return at.scope === "space"
    ? `/spaces/${enc(at.slug)}/${seg}/${enc(id)}`
    : `/${WORK_DOOR_SEGMENT}/${seg}/${enc(id)}`;
}

/** The Work door of an object: its id-only Work address, placed for whoever opens it. */
export function workDoorHref(kind: ObjectKind, id: string): string {
  return addressHref(kind, id, { scope: "work" });
}

/**
 * THE link helper. The hub a link is opened FROM decides the form:
 *   - from any hub but the two storage browsers: the Space-scoped address
 *     when the caller knows the item's Space slug and the kind has a tree
 *     row, otherwise the Work door;
 *   - from the Docs or Tables hub: the canonical URL, exactly as before.
 * A passed slug is only a hint. The Work route's gate places the item in its
 * real Space, so a stale or wrong hint costs one client-side correction
 * before the editor mounts and never renders the item under a wrong crumb.
 */
export function objectHref(kind: ObjectKind, id: string, from: HubKey, spaceSlug?: string | null): string {
  if (!opensInWork(from)) return canonicalHref(kind, id);
  if (spaceSlug && SPACE_SCOPED.has(kind)) return addressHref(kind, id, { scope: "space", slug: spaceSlug });
  return workDoorHref(kind, id);
}

/** Where a Trash lands outside Work: the object's own list in its own hub. */
export function closedObjectHref(kind: ObjectKind): string {
  return `/${OBJECT_SEGMENT[kind]}`;
}

/** An href split into its path and the untouched "?query#hash" tail. */
export function splitHref(href: string): { path: string; tail: string } {
  const cut = href.search(/[?#]/);
  return cut < 0 ? { path: href, tail: "" } : { path: href.slice(0, cut), tail: href.slice(cut) };
}

// The raw segments of a path, with a trailing slash dropped. An empty
// segment anywhere (a doubled slash) is not an object address.
function segmentsOf(path: string): string[] | null {
  if (!path.startsWith("/")) return null;
  let body = path.slice(1);
  if (body.endsWith("/")) body = body.slice(0, -1);
  if (body === "") return [];
  const segs = body.split("/");
  return segs.some((s) => s === "") ? null : segs;
}

function objectId(kind: ObjectKind, raw: string): string | null {
  const id = dec(raw);
  if (!id || RESERVED[kind]?.has(id)) return null;
  return id;
}

/**
 * Which object a path opens, if any: the three address forms, and nothing
 * else. The query, the hash and a trailing slash are ignored and segments
 * are percent-decoded. Static children (/docs/trash, /sops/new) and deeper
 * paths (/forms/{id}/respond) are not objects.
 */
export function openedObject(pathname: string): OpenedObject | null {
  if (typeof pathname !== "string") return null;
  const segs = segmentsOf(splitHref(pathname).path);
  if (!segs) return null;

  if (segs.length === 2) {
    const kind = KIND_BY_SEGMENT.get(segs[0]);
    if (!kind) return null;
    const id = objectId(kind, segs[1]);
    return id ? { kind, id, scope: "canonical", spaceSlug: null } : null;
  }

  if (segs.length === 3 && segs[0] === WORK_DOOR_SEGMENT) {
    const kind = KIND_BY_SEGMENT.get(segs[1]);
    if (!kind) return null;
    const id = objectId(kind, segs[2]);
    return id ? { kind, id, scope: "work", spaceSlug: null } : null;
  }

  if (segs.length === 4 && segs[0] === "spaces") {
    const kind = KIND_BY_SEGMENT.get(segs[2]);
    if (!kind || !SPACE_SCOPED.has(kind)) return null;
    const slug = dec(segs[1]);
    const id = objectId(kind, segs[3]);
    return slug && id ? { kind, id, scope: "space", spaceSlug: slug } : null;
  }

  return null;
}

// Only a same-origin, root-relative path can be an object address. Anything
// else (an absolute URL, a protocol-relative one, mailto:, a relative path,
// an empty string) is returned untouched by every mapper below.
function isRootRelative(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}

/**
 * Any object href (a stored canonical one or a Work one) in the form the
 * section `from` opens, with its ?query and #hash kept. Outside the storage
 * hubs a canonical href becomes the door, and a Work href is kept as it is
 * (its slug is a hint worth keeping); inside Docs or Tables every form
 * becomes canonical. Non-object hrefs come back unchanged, and applying it
 * twice changes nothing.
 */
export function sectionHref(href: string, from: HubKey): string {
  if (!isRootRelative(href)) return href;
  const { path, tail } = splitHref(href);
  const o = openedObject(path);
  if (!o) return href;
  if (opensInWork(from)) return o.scope === "canonical" ? workDoorHref(o.kind, o.id) + tail : href;
  return canonicalHref(o.kind, o.id) + tail;
}

/**
 * The form Copy link puts on the clipboard: the DOOR, from every hub, the
 * storage hubs included. A copied link is sent to somebody else, so it must
 * open in the RECIPIENT'S own Space under their own access, never in the
 * sender's Docs hub; and it never carries a Space's slug (a name, on
 * somebody's clipboard). Non-object hrefs, the public form address among
 * them, are copied as they are.
 *
 * `from` stays in the signature so every caller keeps compiling unchanged;
 * the hub a link is copied from no longer changes what is copied.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function shareHref(href: string, from: HubKey): string {
  if (!isRootRelative(href)) return href;
  const { path, tail } = splitHref(href);
  const o = openedObject(path);
  if (!o) return href;
  return workDoorHref(o.kind, o.id) + tail;
}

/** Which hubs and folded apps this viewer's rail and launcher show. */
export interface SectionVisibility {
  /** A rail hub (the shell's isHubVisible). */
  hub(h: HubKey): boolean;
  /** A folded app key (the shell's launcher apps). */
  app(key: string): boolean;
}

/**
 * Where a CANONICAL address must send a viewer who does not have its storage
 * browser: the door, when the path is a canonical address of one of `kinds`
 * whose hub (CANONICAL_HUB) or folded app (CANONICAL_APP) this viewer's rail
 * does not show; null otherwise. Never for a Work or Space-scoped address,
 * never for a deeper path (/forms/{id}/respond) and never for a static child
 * (/docs/trash, /sops/new), so nothing it answers can send anyone back. The
 * caller keeps the query and the hash.
 */
export function canonicalRedirect(
  pathname: string,
  visible: SectionVisibility,
  kinds: readonly ObjectKind[] = ALL_KINDS,
): string | null {
  const o = openedObject(pathname);
  if (!o || o.scope !== "canonical" || !kinds.includes(o.kind)) return null;
  const app = CANONICAL_APP[o.kind];
  const hasBrowser = visible.hub(CANONICAL_HUB[o.kind]) && (app === undefined || visible.app(app));
  return hasBrowser ? null : workDoorHref(o.kind, o.id);
}

/** Decoded, trailing-slash-normalised path equality; the query and hash are ignored. */
export function sameAddress(a: string, b: string): boolean {
  const norm = (h: string) => {
    const segs = segmentsOf(splitHref(h || "/").path);
    if (!segs) return null;
    const decoded = segs.map(dec);
    return decoded.some((s) => s === null) ? null : `/${decoded.join("/")}`;
  };
  const na = norm(a);
  return na !== null && na === norm(b);
}

/**
 * The call-site form of `objectHref`: the hub comes from the current path,
 * and the object already mounted in the main area answers with the address
 * it is mounted at, so its favourite, its Home row or any link to it never
 * unmounts the editor that shows it.
 */
export function objectHrefFor(
  kind: ObjectKind,
  id: string,
  pathname: string,
  open: OpenObjectRef | null,
  spaceSlug?: string | null,
): string {
  if (open && open.kind === kind && open.id === id) return open.self;
  return objectHref(kind, id, resolveHub(pathname || "/"), spaceSlug);
}

/** The call-site form of `sectionHref`, with the same open-object rule. */
export function sectionHrefFor(href: string, pathname: string, open: OpenObjectRef | null): string {
  if (!isRootRelative(href)) return href;
  const { path, tail } = splitHref(href);
  const o = openedObject(path);
  if (!o) return href;
  if (open && o.kind === open.kind && o.id === open.id) return open.self + tail;
  return sectionHref(href, resolveHub(pathname || "/"));
}

// An anchor's href as a same-origin "path?query#hash", or null when it
// cannot be parsed or points at another origin.
function sameOriginLocal(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  return url.origin === origin ? url.pathname + url.search + url.hash : null;
}

/** Everything the shell's click interceptor knows about one click. */
export interface InterceptInput {
  /** The anchor's resolved href (`a.href`), or its raw attribute. */
  href: string;
  /** window.location.origin. */
  origin: string;
  /** window.location.pathname at the moment of the click. */
  pathname: string;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  /** The anchor sits in an editable region (a link mark in a doc being edited). */
  isContentEditable: boolean;
  download: boolean;
  /** The anchor's target attribute, or null. */
  target: string | null;
  /** data-section-map="off": the anchor asked to be left alone. */
  optOut: boolean;
  open: OpenObjectRef | null;
}

export type InterceptDecision =
  | { action: "none" }
  | { action: "push"; href: string }
  | { action: "open"; href: string };

/**
 * The pure half of the shell's click interceptor. It maps a plain primary
 * click on a same-origin object link into the section it was clicked in, in
 * both directions: a canonical link clicked in Talk, Planner or Work opens
 * in Work, and a Work link clicked in the Docs hub stays in Docs. Modified
 * clicks, middle clicks, downloads, editable regions, opted-out anchors and
 * links that already have the right form are left alone, so the browser (or
 * next/link) does exactly what it did before; newTabHref gives the browser
 * the mapped href for the new-tab gestures.
 */
export function interceptDecision(input: InterceptInput): InterceptDecision {
  const none: InterceptDecision = { action: "none" };
  if (input.defaultPrevented || input.button !== 0) return none;
  if (input.metaKey || input.ctrlKey || input.shiftKey || input.altKey) return none;
  if (input.download || input.optOut || input.isContentEditable) return none;
  const target = (input.target ?? "").trim().toLowerCase();
  if (target !== "" && target !== "_self" && target !== "_blank") return none;

  const local = sameOriginLocal(input.href, input.origin);
  if (local === null) return none;
  const mapped = sectionHrefFor(local, input.pathname, input.open);
  if (mapped === local) return none;
  return target === "_blank" ? { action: "open", href: mapped } : { action: "push", href: mapped };
}

/**
 * Where a link clicked inside a doc being EDITED opens. The interceptor
 * leaves editable regions alone (ProseMirror owns their DOM and their
 * clicks), so BlockNote's own link click handler asks this instead: a
 * same-origin object link opens at its section form, exactly as
 * interceptDecision maps the same link in a read-only doc; anything else
 * opens as written. It never changes the href stored in the doc.
 */
export function editorLinkHref(input: { href: string; origin: string; pathname: string; open: OpenObjectRef | null }): string {
  const local = sameOriginLocal(input.href, input.origin);
  if (local === null) return input.href;
  return sectionHrefFor(local, input.pathname, input.open);
}

/** Everything the interceptor knows about a gesture that opens or copies a link elsewhere. */
export interface NewTabInput {
  /** The href the page rendered on the anchor, resolved (`a.href`) or raw. */
  href: string;
  /** window.location.origin. */
  origin: string;
  /** window.location.pathname at the moment of the gesture. */
  pathname: string;
  /**
   * "press": a pointerdown, an auxclick or a click, read with its button and
   * keys. "menu": the context menu, whose Open link in new tab and Copy link
   * address read the anchor's href, whatever button opened it.
   */
  gesture: "press" | "menu";
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isContentEditable: boolean;
  download: boolean;
  optOut: boolean;
  open: OpenObjectRef | null;
}

/**
 * The href a new-tab gesture on a same-origin object link must carry: the
 * link in its section form, by the same rule and the same opt-outs as
 * interceptDecision. Null when the gesture is not one that opens or copies
 * the link (a plain primary press is the click listener's, alt alone is the
 * browser's download, buttons past the middle one open nothing) or when the
 * href already has the right form.
 *
 * The new-tab gestures are a cmd, ctrl or shift press, a middle press and
 * the context menu. The browser follows the anchor's href attribute for all
 * of them and never runs a page's click handler, so the interceptor writes
 * this answer onto the attribute before the browser acts.
 */
export function newTabHref(input: NewTabInput): string | null {
  if (input.gesture === "press") {
    const newTabKeys = input.metaKey || input.ctrlKey || input.shiftKey;
    if (input.button === 0 ? !newTabKeys : input.button !== 1) return null;
  }
  if (input.download || input.optOut || input.isContentEditable) return null;
  const local = sameOriginLocal(input.href, input.origin);
  if (local === null) return null;
  const mapped = sectionHrefFor(local, input.pathname, input.open);
  return mapped === local ? null : mapped;
}
